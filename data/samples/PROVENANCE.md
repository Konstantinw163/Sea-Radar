# Provenance

## PositionReport sample

- Получено: `2026-11-04T16:06:17.591Z` UTC (`collectedAt` ответа локального endpoint); timestamp позиции в `MetaData.time_utc`: `2026-11-04 16:06:15.382244806 +0000 UTC`.
- Источник: живое WebSocket-соединение с AISStream через локальный `GET /api/snapshot`.
- Район подписки: юго-запад `50.75, 0.95`; северо-восток `51.25, 1.95`.
- Получен исходный объект `MessageType: "PositionReport"`; сохранён без преобразования в `position-report.sample.json`.
- В этой сессии первым пришло служебное сообщение `SubscriptionConfirmation`; reader его пропустил и дождался первого `PositionReport`.
- Наблюдаемые поля: `MetaData` содержит `MMSI`, `MMSI_String`, `ShipName`, `latitude`, `longitude`, `time_utc`; `Message.PositionReport` содержит `Sog`, `Cog`, `TrueHeading`, `Latitude`, `Longitude` и целочисленный `Timestamp`.
- Отличие от документационного примера/схемы: регистр `MetaData.latitude` и `MetaData.longitude` строчный; metadata `time_utc` — строка с наносекундами и UTC. В схеме PositionReport время указано отдельно как целочисленный `Timestamp`.
- Секреты в образец не включались.
