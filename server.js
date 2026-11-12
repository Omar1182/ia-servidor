require("dotenv").config();

const express = require("express");
const crypto = require("node:crypto");

const { rateLimit } = require("express-rate-limit");

const app = express();

const PORT = Number(process.env.PORT || 3000);

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://127.0.0.1:11434";

const API_KEY = process.env.API_KEY;

if (!API_KEY || API_KEY.length < 32) {
  throw new Error("Configura una API_KEY segura en .env");
}

// Modelos permitidos
const MODELOS = {
  chat: "qwen3.5:9b",
  codigo: "qwen2.5-coder:7b",
  vision: "gemma3:4b"
};

// Evitar saturar la RTX 4060
let procesando = false;

// Limitar solicitudes
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

// Permitir JSON
app.use(express.json({
  limit: "64kb"
}));

// Autenticación
function autenticar(req, res, next) {

  const recibida = req.headers["x-api-key"];

  if (typeof recibida !== "string") {
    return res.status(401).json({
      error: "No autorizado"
    });
  }

  const a = Buffer.from(recibida);
  const b = Buffer.from(API_KEY);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      error: "Clave incorrecta"
    });
  }

  next();
}

// Protección de la API
app.use("/api", autenticar, limiter);

// Estado del servidor
app.get("/api/status", (req, res) => {
  res.json({
    online: true,
    servidor: "Mi servidor de IA",
    modelos: Object.keys(MODELOS),
    ocupado: procesando
  });
});

// Chat con Ollama
app.post("/api/chat", async (req, res) => {

  const { modelo, mensajes } = req.body || {};

  if (!Object.hasOwn(MODELOS, modelo)) {
    return res.status(400).json({
      error: "Modelo no permitido"
    });
  }

  if (
    !Array.isArray(mensajes) ||
    mensajes.length < 1 ||
    mensajes.length > 20
  ) {
    return res.status(400).json({
      error: "Historial inválido"
    });
  }

  // Validación de mensajes
  const validos = mensajes.every(m =>
    m &&
    typeof m === "object" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.length > 0 &&
    m.content.length <= 12000
  );

  if (!validos) {
    return res.status(400).json({
      error: "Contenido inválido"
    });
  }

  if (procesando) {
    return res.status(503).json({
      error: "La IA está ocupada. Intenta nuevamente."
    });
  }

  procesando = true;

  try {

    const respuesta = await fetch(
      `${OLLAMA_URL}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        signal: AbortSignal.timeout(180000),

        body: JSON.stringify({
          model: MODELOS[modelo],

          messages: mensajes,

          stream: false,

          options: {
            num_ctx: 4096,
            num_predict: 1024
          }
        })
      }
    );

    if (!respuesta.ok) {
      throw new Error(
        `Ollama devolvió HTTP ${respuesta.status}`
      );
    }

    const resultado = await respuesta.json();

    return res.json({
      success: true,
      modelo,
      respuesta: resultado.message?.content || ""
    });

  } catch (error) {

    console.error("Error consultando Ollama:", error.message);

    return res.status(502).json({
      success: false,
      error: "No fue posible obtener respuesta de Ollama"
    });

  } finally {
    procesando = false;
  }

});

// Iniciar servidor
app.listen(PORT, "127.0.0.1", () => {

  console.log("================================");
  console.log(" SERVIDOR DE IA INICIADO");
  console.log("================================");

  console.log(`Servidor: http://127.0.0.1:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL}`);

  console.log("Modelos disponibles:");

  Object.entries(MODELOS).forEach(([nombre, modelo]) => {
    console.log(`- ${nombre}: ${modelo}`);
  });

});