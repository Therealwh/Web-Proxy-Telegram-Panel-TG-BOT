-- Миграция 004: баланс клиента для личного кабинета бота
ALTER TABLE clients ADD COLUMN balance REAL NOT NULL DEFAULT 0;
