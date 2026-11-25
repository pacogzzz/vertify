import { GoogleGenAI } from "@google/genai";
import type { ReceiptData, BankPhotoData } from "./types";

/**
 * OCR de tickets — diseño intercambiable.
 * Proveedor por defecto: Google Gemini (free tier) con GEMINI_API_KEY.
 * Fallback de pago: Anthropic Haiku con ANTHROPIC_API_KEY.
 * Este módulo SOLO corre en el server (las keys nunca tocan el cliente).
 */

// Prompt EXACTO del prototipo (cuadra.jsx → readReceipt). No modificar.
const RECEIPT_PROMPT = `Eres un extractor de datos de tickets de compra de tiendas en México (HEB, Sam's Club, Costco, Walmart, Soriana, etc.).
Analiza la imagen del ticket y devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown.
Estructura exacta:
{"store": "nombre de la tienda", "dateISO": "YYYY-MM-DD o null", "subtotal": 0, "iva": 0, "ieps": 0, "total": 0, "items": [{"name": "producto", "qty": 1, "price": 0}]}
Reglas: montos como número sin símbolo ni comas. Si un dato no aparece usa 0 (o null en dateISO). Incluye en items todos los productos legibles con su importe total en "price". Si la imagen no es un ticket legible, devuelve {"error":"ilegible"}.`;

function parseReceiptJSON(text: string): ReceiptData {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as ReceiptData;
}

async function readWithGemini(imageBase64: string): Promise<ReceiptData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY");
  // SDK oficial @google/genai — NO usar la ruta OpenAI-compatible (las keys AQ. fallan ahí)
  const ai = new GoogleGenAI({ apiKey });
  const r = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
      { text: RECEIPT_PROMPT },
    ],
    config: { responseMimeType: "application/json" },
  });
  return parseReceiptJSON(r.text ?? "");
}

async function readWithAnthropic(imageBase64: string): Promise<ReceiptData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: RECEIPT_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  return parseReceiptJSON(text);
}

/**
 * Lee un ticket. Intenta el proveedor primario (OCR_PROVIDER, default gemini)
 * y si falla por error técnico cae al otro proveedor si hay key configurada.
 * Un ticket "ilegible" NO dispara el fallback: es una respuesta válida.
 */
export async function readReceipt(imageBase64: string): Promise<ReceiptData> {
  const primary = (process.env.OCR_PROVIDER || "gemini").toLowerCase();
  const order =
    primary === "anthropic"
      ? [readWithAnthropic, readWithGemini]
      : [readWithGemini, readWithAnthropic];

  let lastErr: unknown = null;
  for (const provider of order) {
    try {
      return await provider(imageBase64);
    } catch (err) {
      lastErr = err;
      // sigue con el fallback solo si su key existe; si no, el for termina
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OCR no disponible");
}

/* ============================================================
   OCR de capturas de la app bancaria — Ventas y flujos Fase 2.
   Mismo proveedor/fallback que los tickets, prompt aparte.
   ============================================================ */

const BANK_PROMPT = `Eres un extractor de datos de capturas de pantalla de apps de bancos mexicanos (BBVA, Santander, Banorte, HSBC, Banamex, etc.) que muestran un depósito o movimiento de dinero.
Analiza la imagen y devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown.
Estructura exacta:
{"monto": 0, "concepto": "efectivo", "descripcion": "texto breve de lo que dice el movimiento"}
Reglas: "monto" es el número del depósito, sin símbolo ni comas. "concepto" es "efectivo" si es un depósito en efectivo (ej. "DEPOSITO EFECTIVO", "DEPOSITO EN SUCURSAL", "DEPOSITO CAJERO"), o "tarjeta" si es un pago/cobro electrónico de terminal o plataforma de pagos (ej. "PAGO CLIP", "MERCADO PAGO", "TERMINAL PUNTO DE VENTA", "GETNET", "COBRO RED"). Si no puedes distinguir, usa "tarjeta". Si la imagen no es una captura legible de un movimiento bancario, devuelve {"error":"ilegible"}.`;

function parseBankJSON(text: string): BankPhotoData {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as BankPhotoData;
}

async function readBankWithGemini(imageBase64: string): Promise<BankPhotoData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });
  const r = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
      { text: BANK_PROMPT },
    ],
    config: { responseMimeType: "application/json" },
  });
  return parseBankJSON(r.text ?? "");
}

async function readBankWithAnthropic(imageBase64: string): Promise<BankPhotoData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: BANK_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  return parseBankJSON(text);
}

export async function readBankPhoto(imageBase64: string): Promise<BankPhotoData> {
  const primary = (process.env.OCR_PROVIDER || "gemini").toLowerCase();
  const order =
    primary === "anthropic"
      ? [readBankWithAnthropic, readBankWithGemini]
      : [readBankWithGemini, readBankWithAnthropic];

  let lastErr: unknown = null;
  for (const provider of order) {
    try {
      return await provider(imageBase64);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OCR no disponible");
}
