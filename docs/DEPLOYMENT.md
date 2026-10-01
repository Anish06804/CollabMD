# CollabMD Deployment Guide

## Overview

CollabMD can be deployed as:

- **Frontend** — Vercel (static SPA)
- **Backend** — Render, Railway, or Fly.io (Node.js + WebSocket)
- **Database** — Neon, Supabase, or Render PostgreSQL

## Database Setup

### Neon (recommended)

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string
3. Set `DATABASE_URL` in your backend environment

### Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Use the pooled connection string from Settings → Database
3. Set `DATABASE_URL` in your backend environment

### Render PostgreSQL

1. Create a PostgreSQL instance on Render
2. Use the internal connection string
3. Set `DATABASE_URL` in your backend environment

## Backend Deployment (Render)

1. Create a new **Web Service** on Render
2. Build command: `npm --prefix backend install && npm --prefix backend run build`
3. Start command: `npm --prefix backend run start`
4. Set environment variables:
   - `DATABASE_URL` — your PostgreSQL connection string
   - `PORT` — 4000 (or Render's auto-assigned port)
   - `FRONTEND_URL` — your Vercel URL (for CORS)
   - `PUPPETEER_EXECUTABLE_PATH` — leave unset (uses bundled Chrome)
5. Deploy

## Frontend Deployment (Vercel)

1. Import the repository into Vercel
2. Set the root directory to `frontend`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Set environment variable:
   - `VITE_API_URL` — your backend URL (for production API calls)
6. Deploy

## WebSocket in Production

The frontend connects to the WebSocket using the same host as the page. When deploying to Vercel + Render:

- The WebSocket URL is derived from `window.location` — it will automatically use `wss://` on HTTPS
- Make sure your Render service allows WebSocket connections (it does by default)

## PDF Export in Production

Puppeteer needs Chrome. On Render:

- The `puppeteer` package downloads Chrome during `npm install`
- Add `--no-sandbox` args (already configured in the code)
- If Chrome fails to launch, set `PUPPETEER_EXECUTABLE_PATH` to a system Chrome path

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Backend port (default: 4000) |
| `FRONTEND_URL` | No | Allowed CORS origin (default: http://localhost:5173) |
| `PUPPETEER_EXECUTABLE_PATH` | No | Custom Chrome path for PDF export |
| `NODE_ENV` | No | Set to `production` for production mode |
