Set WshShell = CreateObject("WScript.Shell")
' Путь к вашему .bat файлу. Измените, если он находится в другом месте.
WshShell.Run chr(34) & "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\carwash-operator_angular.bat" & Chr(34), 0
Set WshShell = Nothing