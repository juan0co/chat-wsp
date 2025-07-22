require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Configurar base de datos SQLite
const dbPath = path.join(__dirname, 'papanatas_chat.db');
const db = new sqlite3.Database(dbPath);

// Variable para verificar si las columnas existen
let tieneColumnasComprobante = false;

// *** INICIALIZACIÓN MEJORADA DE LA BASE DE DATOS ***
db.serialize(() => {
  // Crear tabla de conversaciones
  db.run(`CREATE TABLE IF NOT EXISTS conversaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_telefono TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    mensaje_usuario TEXT,
    mensaje_bot TEXT,
    step TEXT,
    session_data TEXT
  )`);

  // Crear tabla de pedidos (estructura básica)
  db.run(`CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_telefono TEXT NOT NULL,
    nombre_cliente TEXT,
    tamaño TEXT,
    agregado TEXT,
    bebida BOOLEAN,
    total INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    estado TEXT DEFAULT 'esperando_pago'
  )`);

  // Verificar y agregar columnas faltantes
  db.all("PRAGMA table_info(pedidos)", (err, columns) => {
    if (!err && columns) {
      const hasComprobanteRecibido = columns.some(col => col.name === 'comprobante_recibido');
      const hasComprobanteUrl = columns.some(col => col.name === 'comprobante_url');
      
      console.log('🔍 Verificando estructura de la base de datos...');
      console.log(`  - comprobante_recibido: ${hasComprobanteRecibido ? '✅' : '❌'}`);
      console.log(`  - comprobante_url: ${hasComprobanteUrl ? '✅' : '❌'}`);
      
      let columnasAgregadas = 0;
      
      if (!hasComprobanteRecibido) {
        db.run(`ALTER TABLE pedidos ADD COLUMN comprobante_recibido BOOLEAN DEFAULT 0`, (alterErr) => {
          if (!alterErr) {
            console.log('✅ Columna comprobante_recibido agregada');
            columnasAgregadas++;
            if (columnasAgregadas === 2 || hasComprobanteUrl) {
              tieneColumnasComprobante = true;
            }
          } else {
            console.log('⚠️ Error agregando comprobante_recibido:', alterErr.message);
          }
        });
      } else {
        columnasAgregadas++;
      }
      
      if (!hasComprobanteUrl) {
        db.run(`ALTER TABLE pedidos ADD COLUMN comprobante_url TEXT`, (alterErr) => {
          if (!alterErr) {
            console.log('✅ Columna comprobante_url agregada');
            columnasAgregadas++;
            if (columnasAgregadas === 2 || hasComprobanteRecibido) {
              tieneColumnasComprobante = true;
            }
          } else {
            console.log('⚠️ Error agregando comprobante_url:', alterErr.message);
          }
        });
      } else {
        columnasAgregadas++;
      }
      
      if (hasComprobanteRecibido && hasComprobanteUrl) {
        tieneColumnasComprobante = true;
        console.log('✅ Base de datos completamente actualizada');
      }
    }
  });
});

// *** FUNCIONES DE BASE DE DATOS COMPATIBLES ***

function guardarMensaje(numeroTelefono, mensajeUsuario, mensajeBot, step, sessionData = null) {
  const stmt = db.prepare(`INSERT INTO conversaciones 
    (numero_telefono, mensaje_usuario, mensaje_bot, step, session_data) 
    VALUES (?, ?, ?, ?, ?)`);
  
  stmt.run(
    numeroTelefono, 
    mensajeUsuario, 
    mensajeBot, 
    step, 
    sessionData ? JSON.stringify(sessionData) : null,
    (err) => {
      if (err) {
        console.error('Error guardando mensaje:', err.message);
      }
    }
  );
  stmt.finalize();
}

function guardarPedido(numeroTelefono, pedido) {
  return new Promise((resolve, reject) => {
    // Usar la estructura básica que siempre existe
    const stmt = db.prepare(`INSERT INTO pedidos 
      (numero_telefono, nombre_cliente, tamaño, agregado, bebida, total, estado) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    
    stmt.run(
      numeroTelefono,
      pedido.nombre,
      pedido.tamaño,
      pedido.agregado,
      pedido.bebida ? 1 : 0,
      calcularTotal(pedido),
      'esperando_pago',
      function(err) {
        if (err) {
          console.error('Error guardando pedido:', err.message);
          reject(err);
        } else {
          console.log('✅ Pedido guardado con ID:', this.lastID);
          resolve(this.lastID);
        }
      }
    );
    stmt.finalize();
  });
}

// *** FUNCIÓN COMPATIBLE PARA ACTUALIZAR ESTADO ***
function actualizarEstadoPedido(numeroTelefono, estado, comprobanteRecibido = false) {
  return new Promise((resolve, reject) => {
    if (tieneColumnasComprobante) {
      // Usar versión completa si las columnas existen
      const stmt = db.prepare(`UPDATE pedidos 
        SET estado = ?, comprobante_recibido = ? 
        WHERE numero_telefono = ? 
        AND id = (
          SELECT MAX(id) FROM pedidos 
          WHERE numero_telefono = ?
        )`);
      
      stmt.run(estado, comprobanteRecibido ? 1 : 0, numeroTelefono, numeroTelefono, (err) => {
        if (err) {
          console.error('Error actualizando estado completo:', err.message);
          // Fallback a versión básica
          actualizarEstadoBasico(numeroTelefono, estado).then(resolve).catch(reject);
        } else {
          console.log(`✅ Estado actualizado (completo): ${estado}, Comprobante: ${comprobanteRecibido}`);
          resolve();
        }
      });
      stmt.finalize();
    } else {
      // Usar solo estado básico
      actualizarEstadoBasico(numeroTelefono, estado).then(resolve).catch(reject);
    }
  });
}

function actualizarEstadoBasico(numeroTelefono, estado) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`UPDATE pedidos 
      SET estado = ? 
      WHERE numero_telefono = ? 
      AND id = (
        SELECT MAX(id) FROM pedidos 
        WHERE numero_telefono = ?
      )`);
    
    stmt.run(estado, numeroTelefono, numeroTelefono, (err) => {
      if (err) {
        console.error('Error actualizando estado básico:', err.message);
        reject(err);
      } else {
        console.log(`✅ Estado actualizado (básico): ${estado}`);
        resolve();
      }
    });
    stmt.finalize();
  });
}

// *** FUNCIÓN COMPATIBLE PARA GUARDAR URL ***
function guardarComprobanteUrl(numeroTelefono, mediaUrl) {
  return new Promise((resolve, reject) => {
    if (tieneColumnasComprobante) {
      const stmt = db.prepare(`UPDATE pedidos 
        SET comprobante_url = ? 
        WHERE numero_telefono = ? 
        AND id = (
          SELECT MAX(id) FROM pedidos 
          WHERE numero_telefono = ?
        )`);
      
      stmt.run(mediaUrl, numeroTelefono, numeroTelefono, (err) => {
        if (err) {
          console.error('Error guardando URL del comprobante:', err.message);
          reject(err);
        } else {
          console.log('✅ URL del comprobante guardada:', mediaUrl);
          resolve();
        }
      });
      stmt.finalize();
    } else {
      // Si no tiene la columna, solo lo loguea y continúa
      console.log('⚠️ URL del comprobante no guardada (columna no existe):', mediaUrl);
      resolve();
    }
  });
}

// Sesión simple por número
const userSessions = {};

// Datos del negocio
const preciosPapas = {
  M: { precio: 2500, gramos: 200 },
  L: { precio: 3000, gramos: 250 },
  XL: { precio: 3400, gramos: 300 }
};

const agregados = {
  premium: {
    nombre: "Salsa de queso cheddar",
    descripcion: "Salsa de queso cheddar fundida",
    precio: { M: 800, L: 1000, XL: 1200 }
  },
  extra_premium: {
    nombre: "Carne mechada o Pulled Pork",
    descripcion: "Carnes cocinadas lentamente",
    precio: { M: 1100, L: 1300, XL: 1500 }
  }
};

const precioBebida = 1200;

// Funciones auxiliares
function calcularTotal(pedido) {
  let total = preciosPapas[pedido.tamaño]?.precio || 0;
  if (pedido.agregado) {
    total += agregados[pedido.agregado]?.precio[pedido.tamaño] || 0;
  }
  if (pedido.bebida) {
    total += precioBebida;
  }
  return total;
}

function resumenPedido(pedido, nombre = "") {
  let texto = `🧾 *Resumen del pedido${nombre ? ` de ${nombre}` : ''}:*\n`;
  texto += `🍟 Papas ${pedido.tamaño} (${preciosPapas[pedido.tamaño].gramos}gr) - $${preciosPapas[pedido.tamaño].precio}\n`;
  
  if (pedido.agregado) {
    const a = agregados[pedido.agregado];
    texto += `➕ ${a.nombre} - $${a.precio[pedido.tamaño]}\n`;
  }
  
  if (pedido.bebida) {
    texto += `🥤 Bebida (350cc) - $${precioBebida}\n`;
  }
  
  texto += `💰 *Total: $${calcularTotal(pedido)}*\n\n`;
  texto += "✅ ¿Está bien tu pedido?\n";
  texto += "1️⃣ Sí, confirmar\n";
  texto += "2️⃣ No, modificar";
  
  return texto;
}

function mensajePago(pedido, nombre = "") {
  let texto = `🎉 *¡Gracias por tu pedido${nombre ? `, ${nombre}` : ''}!*\n\n`;
  texto += `📋 *Resumen:*\n`;
  texto += `🍟 ${pedido.tamaño} ${pedido.agregado ? `+ ${agregados[pedido.agregado].nombre}` : ''}${pedido.bebida ? ' + Bebida' : ''}\n`;
  texto += `💰 Total: *$${calcularTotal(pedido)}*\n\n`;
  texto += "💳 *Datos de transferencia:*\n";
  texto += "🏦 Banco: Banco Estado\n";
  texto += "💳 Cuenta: 123456789\n";
  texto += "👤 Titular: Papanatas SPA\n";
  texto += "🆔 RUT: 12.345.678-9\n";
  texto += "✉️ Correo: pagos@papanatas.cl\n\n";
  texto += "📱 *Envía tu comprobante de pago como imagen o captura de pantalla.*\n\n";
  texto += "Una vez que recibamos tu comprobante, confirmaremos tu pedido y procederemos con la preparación. 🍟";
  return texto;
}

function mensajeComprobanteRecibido(nombre = "") {
  let texto = `✅ *¡Comprobante recibido${nombre ? `, ${nombre}` : ''}!*\n\n`;
  texto += "🔍 Estamos verificando tu pago...\n\n";
  texto += "📞 Te contactaremos en los próximos minutos para confirmar tu pedido y coordinar la entrega.\n\n";
  texto += "🕐 Tiempo estimado de preparación: *15-20 minutos*\n\n";
  texto += "¡Gracias por elegir Papanatas SPA! 🍟";
  return texto;
}

// *** WEBHOOK COMPLETAMENTE COMPATIBLE ***
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const msg = typeof req.body.Body === 'string' ? req.body.Body.trim() : '';
  
  // Manejo de archivos multimedia
  const mediaUrls = [];
  for (let i = 0; i < 10; i++) {
    const mediaUrl = req.body[`MediaUrl${i}`];
    if (mediaUrl) {
      mediaUrls.push(mediaUrl);
    }
  }
  
  const mediaContentType = req.body.MediaContentType0;
  const numMedia = parseInt(req.body.NumMedia) || 0;

  // Log para debuggear
  console.log('=== DEBUG WEBHOOK ===');
  console.log('From:', from);
  console.log('Body:', msg);
  console.log('NumMedia:', numMedia);
  console.log('MediaUrls:', mediaUrls);
  console.log('MediaContentType:', mediaContentType);
  console.log('Columnas comprobante disponibles:', tieneColumnasComprobante);
  console.log('====================');

  // Inicializar sesión si no existe
  if (!userSessions[from]) {
    userSessions[from] = {
      step: "inicio",
      pedido: { nombre: "", tamaño: null, agregado: null, bebida: false },
      pedidoId: null
    };
  }

  const session = userSessions[from];
  const pedido = session.pedido;
  let response = "";

  try {
    switch (session.step) {
      case "inicio":
        response = "👋 Hola, somos *Papanatas SPA* 🍟\n\n¿Cómo te llamas?\n✍️ Escribe tu nombre:";
        session.step = "esperando_nombre";
        break;

      case "esperando_nombre":
        pedido.nombre = msg;
        session.step = "esperando_tamaño";
        response = `¡Hola ${pedido.nombre}! 😊\n\nSelecciona el tamaño de tus papas:\n`;
        response += "1️⃣ M (200 grs - $2.500)\n";
        response += "2️⃣ L (250 grs - $3.000)\n";
        response += "3️⃣ XL (300 grs - $3.400)\n\n";
        response += "Responde con *1*, *2* o *3*";
        break;

      case "esperando_tamaño":
        if (msg === "1") {
          pedido.tamaño = "M";
          session.step = "esperando_agregado_opcion";
          response = "¿Deseas un agregado? 🧀🥓\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "2") {
          pedido.tamaño = "L";
          session.step = "esperando_agregado_opcion";
          response = "¿Deseas un agregado? 🧀🥓\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "3") {
          pedido.tamaño = "XL";
          session.step = "esperando_agregado_opcion";
          response = "¿Deseas un agregado? 🧀🥓\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else {
          response = "❌ Opción no válida. Responde con *1*, *2* o *3*";
        }
        break;

      case "esperando_agregado_opcion":
  if (msg === "1") {
    session.step = "esperando_tipo_agregado";
    const tamañoActual = pedido.tamaño;
    const precioPremium = agregados.premium.precio[tamañoActual];
    const precioExtra = agregados.extra_premium.precio[tamañoActual];
    response = "Selecciona el agregado:\n\n";
    response += `1️⃣ Premium (${agregados.premium.nombre}) - $${precioPremium}\n`;
    response += `2️⃣ Extra Premium (${agregados.extra_premium.nombre}) - $${precioExtra}\n\n`;
    response += `3️⃣ Premium + Extra Premium - $${precioPremium + precioExtra}\n\n`;
    response += "Responde con 1, 2 o 3";
  } else if (msg === "2") { 
    pedido.agregado = null; // NULL PORQUE EL CLIENTE NO QUIERE AGREGADO
    session.step = "esperando_bebida";
    response = `¿Deseas bebida en lata (350cc) por $${precioBebida}? 🥤\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*`;
  } else {
    response = "❌ Opción no válida. Responde con 1 o 2";
  }
  break;

case "esperando_tipo_agregado":
  if (msg === "1") {
    // Solo Premium
    pedido.agregado = "premium";
    session.step = "esperando_bebida";
    response = `¿Deseas bebida en lata (350cc) por $${precioBebida}? 🥤\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*`;
  } else if (msg === "2") {
    // Solo Extra Premium - pregunta por el tipo específico
    pedido.agregado = "extra_premium";
    session.step = "esperando_tipo_extra_premium";
    response = "¿Qué agregado Extra Premium prefieres?\n\n1️⃣ Carne mechada\n2️⃣ Pulled Pork\n\nResponde con 1 o 2";
  } else if (msg === "3") {
    // Premium + Extra Premium - pregunta por el tipo de Extra Premium
    pedido.agregado = ["premium", "extra_premium"];
    session.step = "esperando_tipo_extra_premium";
    response = "¿Para el Extra Premium, prefieres:\n\n1️⃣ Carne mechada\n2️⃣ Pulled Pork\n\nResponde con 1 o 2";
  } else {
    response = "❌ Opción no válida. Responde con 1, 2 o 3";
  }
  break;
  
case "esperando_tipo_extra_premium":  
  if (msg === "1") {
    pedido.tipo_extra = "Carne mechada";
    session.step = "esperando_bebida";
    response = `¿Deseas bebida en lata (350cc) por $${precioBebida}? 🥤\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*`;
  } else if (msg === "2") {
    pedido.tipo_extra = "Pulled Pork";
    session.step = "esperando_bebida";
    response = `¿Deseas bebida en lata (350cc) por $${precioBebida}? 🥤\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*`;
  } else {
    response = "❌ Opción no válida. Responde con 1 o 2";
  }
  break;
  

      case "esperando_bebida":
        if (msg === "1") {
          pedido.bebida = true;
          session.step = "esperando_confirmacion_final";
          response = resumenPedido(pedido, pedido.nombre);
        } else if (msg === "2") {
          pedido.bebida = false;
          session.step = "esperando_confirmacion_final";
          response = resumenPedido(pedido, pedido.nombre);
        } else {
          response = "❌ Opción no válida. Responde con *1* o *2*";
        }
        break;

      case "esperando_confirmacion_final":
        if (msg === "1") {
          session.pedidoId = await guardarPedido(from, pedido);
          session.step = "esperando_comprobante";
          response = mensajePago(pedido, pedido.nombre);
        } else if (msg === "2") {
          session.step = "modificando_pedido";
          response = "🔄 *¿Qué deseas modificar?*\n\n";
          response += "1️⃣ Tamaño\n";
          response += "2️⃣ Agregado\n";
          response += "3️⃣ Bebida\n\n";
          response += "Selecciona *1*, *2* o *3*";
        } else {
          response = "❌ Opción no válida. Responde con *1* o *2*";
        }
        break;

      case "esperando_comprobante":
        // *** MANEJO COMPATIBLE DE COMPROBANTES ***
        
        const tieneImagen = numMedia > 0 && mediaUrls.length > 0;
        const esImagenValida = tieneImagen && mediaContentType && 
                             mediaContentType.startsWith('image/');
        
        if (tieneImagen) {
          console.log(`📸 Procesando imagen de ${from}: ${mediaUrls[0]}`);
          
          if (esImagenValida) {
            // Imagen válida recibida
            console.log('✅ Imagen válida, procesando...');
            
            try {
              // Actualizar estado (compatible con ambas versiones de BD)
              await actualizarEstadoPedido(from, 'comprobante_recibido', true);
              
              // Guardar URL si es posible
              await guardarComprobanteUrl(from, mediaUrls[0]);
              
              response = mensajeComprobanteRecibido(pedido.nombre);
              session.step = "pedido_completado";
              
              console.log('✅ Comprobante procesado correctamente');
              
            } catch (dbError) {
              console.error('❌ Error en base de datos:', dbError.message);
              // Responder positivamente al cliente aunque haya error en BD
              response = mensajeComprobanteRecibido(pedido.nombre);
              session.step = "pedido_completado";
            }
            
          } else {
            // Archivo adjunto pero no es imagen válida
            response = "🚫 *Formato no válido*\n\n";
            response += "Por favor envía una *imagen* (JPG, PNG) de tu comprobante de pago.\n\n";
            response += "📱 Puedes enviar:\n";
            response += "• Foto del comprobante\n";
            response += "• Captura de pantalla\n\n";
            response += "💡 O escribe 'enviado' si ya realizaste la transferencia.";
          }
        } 
        // Si no hay imagen, procesar texto
        else if (msg) {
          const msgLower = msg.toLowerCase();
          
          if (msgLower.includes('enviado') || msgLower.includes('listo') || 
              msgLower.includes('transferido') || msgLower.includes('pagado')) {
            // Confirmación por texto
            try {
              await actualizarEstadoPedido(from, 'comprobante_recibido', true);
              response = mensajeComprobanteRecibido(pedido.nombre);
              session.step = "pedido_completado";
            } catch (dbError) {
              console.error('❌ Error en base de datos:', dbError.message);
              response = mensajeComprobanteRecibido(pedido.nombre);
              session.step = "pedido_completado";
            }
            
          } else if (msgLower.includes('ayuda') || msgLower.includes('como') || 
                    msgLower.includes('instrucciones')) {
            response = "📱 *¿Cómo enviar el comprobante?*\n\n";
            response += "✅ **Opción 1:** Enviar imagen\n";
            response += "1️⃣ Toma foto del comprobante\n";
            response += "2️⃣ Adjúntala a este chat\n";
            response += "3️⃣ Envíala (sin texto adicional)\n\n";
            response += "✅ **Opción 2:** Confirmación por texto\n";
            response += "• Escribe: 'enviado' o 'listo'\n\n";
            response += "⏰ Horario de verificación: 9:00 AM - 8:00 PM";
            
          } else {
            // Mensaje no reconocido
            response = "🤔 *No entendí tu mensaje*\n\n";
            response += "📸 **Para enviar comprobante:**\n";
            response += "• Adjunta la imagen de tu comprobante\n";
            response += "• O escribe 'enviado' si ya pagaste\n\n";
            response += "❓ Escribe 'ayuda' para más instrucciones";
          }
        } 
        // Ni imagen ni texto
        else {
          response = "📱 *Esperando tu comprobante*\n\n";
          response += "Por favor:\n";
          response += "📸 Envía foto del comprobante, o\n";
          response += "✍️ Escribe 'enviado' si ya pagaste\n\n";
          response += "💡 Escribe 'ayuda' si necesitas instrucciones";
        }
        break;

      case "pedido_completado":
        response = `¡Hola ${pedido.nombre}! 😊\n\n`;
        response += "Tu pedido ya está en proceso. Si necesitas hacer un nuevo pedido, escribe *nuevo* o *hola*.\n\n";
        response += "📞 Para consultas sobre tu pedido actual, contáctanos directamente.";
        
        if (msg.toLowerCase().includes('nuevo') || msg.toLowerCase().includes('hola')) {
          delete userSessions[from];
          response = "👋 ¡Hola de nuevo! ¿Quieres hacer un nuevo pedido?\n\n¿Cómo te llamas?\n✍️ Escribe tu nombre:";
        }
        break;

      case "modificando_pedido":
        if (msg === "1") {
          session.step = "esperando_tamaño_modificacion";
          response = "Selecciona nuevo tamaño:\n\n";
          response += "1️⃣ M (200 grs - $2.500)\n";
          response += "2️⃣ L (250 grs - $3.000)\n";
          response += "3️⃣ XL (300 grs - $3.400)\n\n";
          response += "Responde con *1*, *2* o *3*";
        } else if (msg === "2") {
          session.step = "esperando_agregado_opcion";
          response = "¿Deseas un nuevo agregado? 🧀🥓\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "3") {
          session.step = "esperando_bebida";
          response = `¿Deseas bebida en lata (350cc) por ${precioBebida}? 🥤\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*`;
        } else {
          response = "❌ Opción no válida. Responde con *1*, *2* o *3*";
        }
        break;

      case "esperando_tamaño_modificacion":
        if (msg === "1") {
          pedido.tamaño = "M";
          session.step = "preguntando_cambio_agregado";
          response = "¿Quieres cambiar también el agregado? 🤔\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "2") {
          pedido.tamaño = "L";
          session.step = "preguntando_cambio_agregado";
          response = "¿Quieres cambiar también el agregado? 🤔\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "3") {
          pedido.tamaño = "XL";
          session.step = "preguntando_cambio_agregado";
          response = "¿Quieres cambiar también el agregado? 🤔\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else {
          response = "❌ Opción no válida. Responde con *1*, *2* o *3*";
        }
        break;

      case "preguntando_cambio_agregado":
        if (msg === "1") {
          session.step = "esperando_agregado_opcion";
          response = "¿Deseas un agregado? 🧀🥓\n\n1️⃣ Sí\n2️⃣ No\n\nResponde con *1* o *2*";
        } else if (msg === "2") {
          session.step = "esperando_confirmacion_final";
          response = resumenPedido(pedido, pedido.nombre);
        } else {
          response = "❌ Opción no válida. Responde con *1* o *2*";
        }
        break;

      default:
        response = "👋 Escribe *hola* para iniciar un nuevo pedido.";
        delete userSessions[from];
        session.step = "inicio";
    }

  } catch (error) {
    console.error('❌ Error en el webhook:', error);
    response = "❌ Ocurrió un error. Por favor, intenta nuevamente escribiendo *hola*.";
    delete userSessions[from];
  }

  // Guardar conversación en base de datos
  guardarMensaje(from, msg, response, session.step, session);

  // Enviar respuesta via Twilio
  client.messages
    .create({
      body: response,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
    })
    .then(() => {
      console.log('✅ Mensaje enviado correctamente');
      res.sendStatus(200);
    })
    .catch((err) => {
      console.error("❌ Error enviando mensaje:", err);
      res.sendStatus(500);
    });
});

// *** ENDPOINTS PARA STREAMLIT (COMPATIBLES) ***

app.get("/api/conversaciones", (req, res) => {
  db.all(`SELECT * FROM conversaciones ORDER BY timestamp DESC LIMIT 200`, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.get("/api/pedidos", (req, res) => {
  // Query básico que funciona con cualquier estructura
  let query = `SELECT id, numero_telefono, nombre_cliente, tamaño, agregado, bebida, total, timestamp, estado`;
  
  // Agregar columnas opcionales si existen
  if (tieneColumnasComprobante) {
    query += `, comprobante_recibido, comprobante_url`;
  }
  
  query += ` FROM pedidos ORDER BY timestamp DESC`;
  
  db.all(query, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.get("/api/comprobantes", (req, res) => {
  if (tieneColumnasComprobante) {
    db.all(`SELECT id, numero_telefono, nombre_cliente, total, comprobante_url, timestamp, estado 
            FROM pedidos 
            WHERE comprobante_url IS NOT NULL 
            ORDER BY timestamp DESC`, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  } else {
    // Si no tiene las columnas, devolver lista vacía
    res.json([]);
  }
});

// Endpoint de estado del sistema
app.get("/api/estado", (req, res) => {
  res.json({
    estado: "activo",
    base_datos: "conectada",
    columnas_comprobante: tieneColumnasComprobante,
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.send(`
    <h1>🍟 Papanatas SPA - Sistema Completo</h1>
    <h2>📊 Estado del Sistema</h2>
    <p>✅ Bot de WhatsApp activo</p>
    <p>✅ Base de datos conectada</p>
    <p>${tieneColumnasComprobante ? '✅' : '⚠️'} Columnas de comprobante: ${tieneColumnasComprobante ? 'Disponibles' : 'No disponibles'}</p>
    <p>✅ Manejo compatible implementado</p>
    <hr>
    <h3>🔗 Enlaces:</h3>
    <p>📱 Webhook: <code>/webhook</code></p>
    <p>📊 API Conversaciones: <a href="/api/conversaciones">/api/conversaciones</a></p>
    <p>📋 API Pedidos: <a href="/api/pedidos">/api/pedidos</a></p>
    <p>📸 API Comprobantes: <a href="/api/comprobantes">/api/comprobantes</a></p>
    <p>🔧 API Estado: <a href="/api/estado">/api/estado</a></p>
    <hr>
    <h3>💡 Instrucciones:</h3>
    <p>Si necesitas agregar las columnas de comprobante, ejecuta el script de migración.</p>
    <p><small>🕐 ${new Date().toLocaleString()}</small></p>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor Papanatas SPA activo en puerto ${PORT}`);
  console.log(`📱 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`📊 Dashboard: http://localhost:8501`);
  console.log(`🌍 Para ngrok: ngrok http ${PORT}`);
  console.log(`🔧 Compatibilidad: ACTIVADA`);
  console.log(`📸 Columnas comprobante: ${tieneColumnasComprobante ? 'DISPONIBLES' : 'PENDIENTES'}`);
});

// Cerrar BD al terminar proceso
process.on('SIGINT', () => {
  console.log('🔄 Cerrando conexión a la base de datos...');
  db.close((err) => {
    if (err) {
      console.error('Error cerrando la base de datos:', err.message);
    } else {
      console.log('✅ Base de datos cerrada correctamente');
    }
  });
  process.exit();
});