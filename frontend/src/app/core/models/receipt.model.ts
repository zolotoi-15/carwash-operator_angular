// frontend/src/app/core/models/receipt.model.ts

export interface ReceiptItem {
  name: string;
  price: number;         // цена за единицу (секунду), для MQTT-печати
  quantity: number;      // количество (секунды)
  department?: number;
  tax?: number;
}

export interface ReceiptServiceLine {
  name: string;
  pricePerSecond: number;
  seconds: number;
  total: number;
}

export interface ReceiptData {
  id?: number | string;
  receiptNumber?: number;
  postId: number;
  date: string;                // ISO
  total: number;

  /** Тип чека: 'session' | 'topup_card' | 'topup_post' */
  kind?: string;

  /** Способ оплаты: 'cash' | 'card_terminal' | 'client_card' | null */
  paymentMethod?: string | null;

  /** Строки чека (новая схема) */
  services: ReceiptServiceLine[];

  /** Устаревшее поле (оставлено для совместимости с PDF-выгрузкой) */
  fiscal?: boolean;

  // ---- Опциональные поля, используемые при печати/отправке ----
  items?: ReceiptItem[];
  totalCash?: number;
  cashierName?: string;
  operation?: string;
  balance?: number;
  timestamp?: Date | string;
}