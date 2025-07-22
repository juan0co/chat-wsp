# 🍟 Papanatas SPA - Bot de WhatsApp con Dashboard

Sistema completo de bot de WhatsApp para pedidos de papas fritas con base de datos SQLite y dashboard en tiempo real con Streamlit.

## 🚀 Características

- ✅ Bot conversacional de WhatsApp via Twilio
- ✅ Base de datos SQLite local para guardar conversaciones y pedidos
- ✅ Dashboard en tiempo real con Streamlit
- ✅ Métricas de ventas y estadísticas
- ✅ Visualización de conversaciones en vivo
- ✅ Gráficos interactivos con Plotly

## 📋 Requisitos Previos

1. **Node.js** (versión 16 o superior)
2. **Python 3.8+**
3. **Cuenta de Twilio** con WhatsApp configurado
4. **ngrok** (para exposer el webhook localmente)

## 🛠️ Instalación

### 1. Clonar y configurar el proyecto

```bash
# Crear directorio del proyecto
mkdir papanatas-whatsapp-bot
cd papanatas-whatsapp-bot

# Copiar todos los archivos proporcionados:
# - index.js
# - streamlit_dashboard.py
# - package.json
# - requirements.txt
# - start.sh
```

### 2. Configurar credenciales de Twilio

Crear archivo `.env` con tus credenciales:

```env
TWILIO_ACCOUNT_SID=tu_account_sid_aqui
TWILIO_AUTH_TOKEN=tu_auth_token_aqui
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
PORT=3000
```

'
#### Opción B: Instalación manual

```bash
# Instalar dependencias de Node.js
npm install

# Crear entorno virtual de Python
python3 -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate

# Instalar dependencias de Python
pip install -r requirements.txt
```


### Método 2: Ejecución manual

```bash
# Terminal 1: 
node index.js   para abrir puerto 
npx ngrok http 3000 ngrok


# Terminal 2: Iniciar dashboard Streamlit
source venv/bin/activate
streamlit run streamlit_dashboard.py
```

## 🌐 Configurar Webhook de Twilio

1. **Instalar ngrok** (si no lo tienes):
   ```bash
   # macOS
   brew install ngrok
   
   # Ubuntu/Debian
   sudo apt install ngrok
   
   # Windows: descargar desde https://ngrok.com/download
   ```

2. **Exponer el servidor local**:
   ```bash
   ngrok http 3000
   ```

3. **Configurar en Twilio Console**:
   - Ve a tu [Twilio Console](https://console.twilio.com/)
   - Busca "WhatsApp Sandbox Settings"
   - En "Webhook URL" pon: `https://tu-url-ngrok.ngrok.io/webhook`
   - Método: `POST`

## 📊 Usando el Dashboard

Una vez iniciado, abre `http://localhost:8501` para ver:

### 🏠 Vista Principal
- **Métricas en tiempo real**: Pedidos totales, ventas del día, conversaciones activas
- **Auto-refresh**: Actualización automática cada 3 segundos (configurable)

### 💬 Chat en Vivo
- Conversaciones en tiempo real
- Historial de mensajes usuario-bot
- Estado actual de cada conversación

### 📋 Pedidos
- Lista completa de pedidos completados
- Filtro por fecha
- Detalles de cada pedido (cliente, productos, total)

### 📊 Estadísticas
- Distribución por tamaños de papas
- Agregados más populares
- Ventas por hora del día

### 📈 Gráficos
- Gráficos de pie para distribución de productos
- Timeline de ventas
- Gráficos interactivos con Plotly

## 🗄️ Base de Datos

El sistema crea automáticamente una base de datos SQLite (`papanatas_chat.db`) con dos tablas:

### Tabla `conversaciones`
- `id`: ID único
- `numero_telefono`: Número del cliente
- `timestamp`: Fecha y hora del mensaje
- `mensaje_usuario`: Mensaje enviado por el cliente
- `mensaje_bot`: Respuesta del bot
- `step`: Paso actual en el flujo de conversación
- `session_data`: Datos de sesión en JSON

### Tabla `pedidos`
- `id`: ID único del pedido
- `numero_telefono`: Número del cliente
- `nombre_cliente`: Nombre del cliente
- `tamaño`: Tamaño de papas (M/L/XL)
- `agregado`: Tipo de agregado (premium/extra_premium/null)
- `bebida`: Si incluyó bebida (0/1)
- `total`: Total del pedido
- `timestamp`: Fecha y hora del pedido
- `estado`: Estado del pedido (por defecto: 'pendiente')

## 🔧 Configuración Avanzada

### Personalizar Auto-refresh
En el dashboard, puedes:
- Activar/desactivar auto-refresh
- Cambiar intervalo de actualización (1-10 segundos)
- Actualizar manualmente con el botón

### Filtros de Datos
- Mostrar solo pedidos del día actual
- Filtrar conversaciones por número
- Limitar cantidad de mensajes mostrados

## 🛟 Solución de Problemas

### Error de conexión a base de datos
```bash
# Verificar que el archivo de BD existe
ls -la papanatas_chat.db

# Si no existe, se creará automáticamente al recibir el primer mensaje
```

### Puerto ocupado
```bash
# Cambiar puerto en .env
PORT=3001

# O matar proceso que usa el puerto
lsof -ti:3000 | xargs kill -9
```

### Problemas con ngrok
```bash
# Verificar que ngrok está funcionando
ngrok http 3000

# Copiar la URL HTTPS (no HTTP) a Twilio
```

### Error de dependencias Python
```bash
# Reinstalar entorno virtual
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 📱 Flujo de Conversación del Bot

1. **Inicio**: Saludo y solicitud de nombre
2. **Tamaño**: Selección de tamaño de papas (M/L/XL)
3. **Agregado**: Opción de agregar salsa o carne
4. **Bebida**: Opción de incluir bebida
5. **Confirmación**: Resumen del pedido
6. **Modificación**: Opción de cambiar elementos
7. **Pago**: Información bancaria para transferencia

## 🔄 Actualizaciones y Mantenimiento

### Backup de la base de datos
```bash
# Crear backup
cp papanatas_chat.db papanatas_chat_backup_$(date +%Y%m%d).db

# Restaurar backup
cp papanatas_chat_backup_20241201.db papanatas_chat.db
```

### Limpiar datos antiguos
```sql
-- Eliminar conversaciones de hace más de 30 días
DELETE FROM conversaciones 
WHERE timestamp < datetime('now', '-30 days');

-- Eliminar pedidos antiguos (opcional)
DELETE FROM pedidos 
WHERE timestamp < datetime('now', '-90 days');
```

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crea un Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver archivo `LICENSE` para más detalles.

## 🆘 Soporte

Si tienes problemas o preguntas:

1. Revisa la sección de solución de problemas
2. Verifica que todas las dependencias están instaladas
3. Asegúrate de que las credenciales de Twilio son correctas
4. Comprueba que ngrok está exponiendo correctamente el puerto

---

**¡Disfruta vendiendo papas fritas! 🍟**