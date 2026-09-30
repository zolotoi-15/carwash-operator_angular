import cv2
import json
import asyncio
import websockets
import numpy as np
from ultralytics import YOLO
from collections import defaultdict
import uuid

# Загружаем модель YOLO (можно использовать yolov8n.pt, yolov8s.pt и т.д.)
model = YOLO('yolov8n.pt')  # предварительно скачайте модель

# Хранилище для трекинга
tracked_objects = {}  # track_id -> { 'label': str, 'last_seen': frame_count }
frame_counter = 0
MAX_MISSED_FRAMES = 10  # если объект не появлялся более N кадров, удаляем

# Классы, которые нас интересуют (COCO)
TARGET_CLASSES = ['car', 'truck', 'bus', 'motorcycle', 'person']

async def process_video(websocket, path):
    global frame_counter
    # Открываем видеопоток (RTSP или файл)
    # Для теста используем веб-камеру или файл:
    # cap = cv2.VideoCapture(0)  # веб-камера
    # или RTSP:
    # cap = cv2.VideoCapture('rtsp://username:password@ip:port/stream')
    cap = cv2.VideoCapture('https://flussonic2.powernet.com.ru:444/user101962/embed.html?token=dont-panic-and-carry-a-towel&autoplay=true')  # не подойдёт, нужен прямой поток
    
    # Если это embed.html – не работает. Лучше использовать HLS или RTSP.
    # В реальности нужно получать прямой видеопоток (RTSP, HLS, MJPEG).
    # Для демонстрации используем веб-камеру.
    # cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Не удалось открыть видеопоток")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_counter += 1

        # Распознавание объектов
        results = model(frame, stream=True, verbose=False)
        detections = []
        current_frame_ids = set()

        for r in results:
            boxes = r.boxes
            if boxes is None:
                continue
            for box in boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                label = model.names[cls_id]
                if label not in TARGET_CLASSES or conf < 0.5:
                    continue

                # Трекинг: находим существующий объект по совпадению IOU
                track_id = None
                for tid, obj in tracked_objects.items():
                    prev_box = obj['box']
                    # Простой трекинг по пересечению
                    iou = compute_iou([x1, y1, x2, y2], prev_box)
                    if iou > 0.5:
                        track_id = tid
                        break

                if track_id is None:
                    track_id = str(uuid.uuid4())  # новый объект

                tracked_objects[track_id] = {
                    'label': label,
                    'box': [x1, y1, x2, y2],
                    'last_seen': frame_counter
                }
                current_frame_ids.add(track_id)

                detections.append({
                    'track_id': track_id,
                    'label': label,
                    'bbox': [x1, y1, x2, y2],
                    'confidence': conf
                })

        # Удаляем потерянные объекты
        to_remove = []
        for tid, obj in tracked_objects.items():
            if frame_counter - obj['last_seen'] > MAX_MISSED_FRAMES:
                to_remove.append(tid)
        for tid in to_remove:
            del tracked_objects[tid]

        # Подсчёт объектов по классам
        counts = {}
        for tid, obj in tracked_objects.items():
            label = obj['label']
            counts[label] = counts.get(label, 0) + 1

        # Отправляем данные через WebSocket
        data = {
            'frame': frame_counter,
            'detections': detections,
            'counts': counts,
            'timestamp': asyncio.get_event_loop().time()
        }
        await websocket.send(json.dumps(data))

        # Для демонстрации можно ограничить FPS
        await asyncio.sleep(0.05)

    cap.release()

def compute_iou(box1, box2):
    # box = [x1, y1, x2, y2]
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union_area = box1_area + box2_area - inter_area
    return inter_area / union_area if union_area > 0 else 0

async def main():
    async with websockets.serve(process_video, "0.0.0.0", 8765):
        print("WebSocket сервер запущен на порту 8765")
        await asyncio.Future()  # вечно

if __name__ == "__main__":
    asyncio.run(main())
