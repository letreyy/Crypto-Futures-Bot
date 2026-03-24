# Binance USDT-M Perpetual Signals Bot (MVP)

Production-ready Telegram bot for crypto signals on Binance Futures.

## Features
- **Scans Top 30 Symbols** by 24h quote volume.
- **Multiple Timeframes:** Uses 5m for primary signals and 15m for trend context.
- **Advanced Market Regime Engine:** TREND, RANGE, PANIC, VOLATILITY_EXPANSION detection.
- **Liquidity Mapping:** Detects swing highs/lows and liquidity sweeps.
- **13 Strategies Built-in:**
  - EMA Pullback
  - Micro Pullback
  - Momentum Breakout
  - Squeeze Breakout
  - VWAP Reversion
  - Liquidity Sweep
  - Dump Bounce
  - Range Bounce
  - Breakout Failure
  - Pump Detector
- **Scoring Engine:** Numeric confidence scores (0-100) with A+/A/B/C labels.
- **Risk Calculation:** Dynamic Entry, Stop-Loss, and Take-Profit (TP1, TP2, TP3).
- **Spam Protection:** In-memory deduplication and cooldown mechanism.
- **Telegram Notifications:** Beautifully formatted Markdown messages with rationale.

## Tech Stack
- TypeScript / Node.js
- Docker / Docker Compose
- Portainer Support
- Winston Logger (with daily rotation)

---

## 🚀 Quick Start (Local)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Binance API Key and Telegram Bot Token
   ```

3. **Run in Development Mode:**
   ```bash
   npm run dev
   ```

4. **Build and Run (Production Mode):**
   ```bash
   npm run build
   npm run start
   ```

---

## 🐳 Docker Deployment

1. **Build and Start Container:**
   ```bash
   docker-compose up -d --build
   ```

2. **Check Logs:**
   ```bash
   docker-compose logs -f
   ```

---

## 🚢 Portainer Stack Deployment

1. Login to **Portainer**.
2. Go to **Stacks** -> **Add Stack**.
3. Select **Web editor**.
4. Paste the contents of `docker-compose.yml`.
5. Add the environment variables from `.env` in the **Environment variables** section of the stack.
6. Click **Deploy the stack**.

---

## 🛠 Project Structure

- `src/core/`: Common types, enums, utils, and logger.
- `src/exchange/`: Binance API client.
- `src/market/`: Engines for indicators, regime, and liquidity.
- `src/strategies/`: Plug-and-play strategy modules.
- `src/scoring/`: Logic for signal score and confidence.
- `src/risk/`: SL/TP and risk-per-trade calculation.
- `src/notifications/`: Telegram bot integration.
- `src/worker/`: Main execution loop.
- `src/bootstrap/`: App entry point.

---

## ⚠️ Important Note
This bot is for **informational purposes only**. It does not execute trades automatically. Crypto trading involves high risk. Use the signals at your own discretion.
