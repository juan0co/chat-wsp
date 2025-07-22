import streamlit as st
import sqlite3
import pandas as pd
import json
from datetime import datetime, timedelta
import time

# Configuración de la página
st.set_page_config(
    page_title="🍟 Papanatas SPA - Chat Dashboard",
    page_icon="🍟",
    layout="wide",
    initial_sidebar_state="expanded"
)

# CSS para estilo WhatsApp
st.markdown("""
<style>
    .chat-container {
        background-color: #0e1117;
        border-radius: 15px;
        padding: 20px;
        margin: 10px 0;
        max-height: 600px;
        overflow-y: auto;
    }
    
    .message-user {
        background-color: #dcf8c6;
        color: #000;
        padding: 10px 15px;
        border-radius: 18px 18px 5px 18px;
        margin: 5px 0;
        margin-left: 20%;
        text-align: right;
        word-wrap: break-word;
    }
    
    .message-bot {
        background-color: #ffffff;
        color: #000;
        padding: 10px 15px;
        border-radius: 18px 18px 18px 5px;
        margin: 5px 0;
        margin-right: 20%;
        text-align: left;
        word-wrap: break-word;
    }
    
    .message-time {
        font-size: 0.8em;
        color: #888;
        margin-top: 5px;
    }
    
    .estado-esperando {
        background-color: #ffc107;
        color: #000;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 0.8em;
    }
    
    .estado-completado {
        background-color: #28a745;
        color: white;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 0.8em;
    }
    
    .estado-comprobante {
        background-color: #17a2b8;
        color: white;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 0.8em;
    }
</style>
""", unsafe_allow_html=True)

# *** FUNCIONES COMPATIBLES PARA BASE DE DATOS ***

@st.cache_resource
def init_connection():
    return sqlite3.connect('papanatas_chat.db', check_same_thread=False)

conn = init_connection()

def verificar_estructura_bd():
    """Verifica qué columnas están disponibles en la base de datos"""
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(pedidos)")
        columns = cursor.fetchall()
        
        column_names = [col[1] for col in columns]
        
        tiene_comprobante_recibido = 'comprobante_recibido' in column_names
        tiene_comprobante_url = 'comprobante_url' in column_names
        
        return {
            'tiene_comprobante_recibido': tiene_comprobante_recibido,
            'tiene_comprobante_url': tiene_comprobante_url,
            'columnas': column_names
        }
    except Exception as e:
        st.error(f"Error verificando estructura: {e}")
        return {
            'tiene_comprobante_recibido': False,
            'tiene_comprobante_url': False,
            'columnas': []
        }

# Verificar estructura al inicio
estructura_bd = verificar_estructura_bd()

@st.cache_data(ttl=2)
def get_conversaciones_por_numero():
    """Obtiene conversaciones con compatibilidad para diferentes estructuras de BD"""
    try:
        # Método más simple y robusto: consultas separadas
        
        # 1. Obtener conversaciones básicas
        query_conversaciones = """
        SELECT 
            numero_telefono,
            MAX(timestamp) as ultima_actividad,
            COUNT(id) as total_mensajes,
            MAX(CASE WHEN session_data IS NOT NULL THEN 
                json_extract(session_data, '$.pedido.nombre') 
            END) as nombre_cliente
        FROM conversaciones
        WHERE mensaje_usuario IS NOT NULL OR mensaje_bot IS NOT NULL
        GROUP BY numero_telefono 
        ORDER BY MAX(timestamp) DESC
        """
        
        conversaciones_df = pd.read_sql_query(query_conversaciones, conn)
        
        # 2. Si tenemos la tabla pedidos, obtener información adicional
        if 'estado' in estructura_bd['columnas']:
            try:
                # Construir query de pedidos según columnas disponibles
                pedidos_columns = ['numero_telefono', 'estado', 'total']
                if estructura_bd['tiene_comprobante_recibido']:
                    pedidos_columns.append('comprobante_recibido')
                if estructura_bd['tiene_comprobante_url']:
                    pedidos_columns.append('comprobante_url')
                
                query_pedidos = f"""
                SELECT {', '.join(pedidos_columns)},
                       ROW_NUMBER() OVER (PARTITION BY numero_telefono ORDER BY timestamp DESC) as rn
                FROM pedidos
                """
                
                pedidos_df = pd.read_sql_query(query_pedidos, conn)
                pedidos_df = pedidos_df[pedidos_df['rn'] == 1].drop('rn', axis=1)
                
                # Merge con conversaciones
                conversaciones_df = conversaciones_df.merge(
                    pedidos_df, 
                    on='numero_telefono', 
                    how='left'
                )
                
            except Exception as e:
                print(f"Error cargando pedidos: {e}")
                # Si falla, agregar columnas vacías
                pass
        
        # 3. Asegurar que todas las columnas esperadas existen
        if 'estado' not in conversaciones_df.columns:
            conversaciones_df['estado'] = None
        if 'comprobante_recibido' not in conversaciones_df.columns:
            conversaciones_df['comprobante_recibido'] = 0
        if 'comprobante_url' not in conversaciones_df.columns:
            conversaciones_df['comprobante_url'] = None
        if 'total' not in conversaciones_df.columns:
            conversaciones_df['total'] = None
        
        return conversaciones_df
        
    except Exception as e:
        st.error(f"Error cargando conversaciones: {e}")
        # Devolver DataFrame vacío con la estructura esperada
        return pd.DataFrame(columns=[
            'numero_telefono', 'ultima_actividad', 'total_mensajes', 
            'nombre_cliente', 'estado', 'comprobante_recibido', 
            'comprobante_url', 'total'
        ])

@st.cache_data(ttl=2)
def get_mensajes_numero(numero_telefono):
    """Obtiene mensajes de un número específico"""
    try:
        query = """
        SELECT timestamp, mensaje_usuario, mensaje_bot, step
        FROM conversaciones 
        WHERE numero_telefono = ?
        ORDER BY timestamp ASC
        """
        return pd.read_sql_query(query, conn, params=[numero_telefono])
    except Exception as e:
        st.error(f"Error cargando mensajes: {e}")
        return pd.DataFrame()

@st.cache_data(ttl=10)
def get_estadisticas_generales():
    """Obtiene estadísticas generales con compatibilidad"""
    try:
        hoy = datetime.now().strftime('%Y-%m-%d')
        
        # Estadísticas de conversaciones (siempre disponible)
        query_stats = f"""
        SELECT 
            COUNT(DISTINCT numero_telefono) as conversaciones_hoy,
            COUNT(*) as mensajes_hoy
        FROM conversaciones 
        WHERE DATE(timestamp) = '{hoy}'
        """
        stats = pd.read_sql_query(query_stats, conn)
        
        # Estadísticas de pedidos (si la tabla existe)
        try:
            if estructura_bd['tiene_comprobante_recibido']:
                query_pedidos = f"""
                SELECT 
                    COUNT(*) as pedidos_hoy,
                    COALESCE(SUM(total), 0) as ventas_hoy,
                    COUNT(CASE WHEN comprobante_recibido = 1 THEN 1 END) as comprobantes_recibidos,
                    COUNT(CASE WHEN estado = 'esperando_pago' THEN 1 END) as esperando_pago
                FROM pedidos 
                WHERE DATE(timestamp) = '{hoy}'
                """
            else:
                query_pedidos = f"""
                SELECT 
                    COUNT(*) as pedidos_hoy,
                    COALESCE(SUM(total), 0) as ventas_hoy,
                    0 as comprobantes_recibidos,
                    COUNT(CASE WHEN estado = 'esperando_pago' THEN 1 END) as esperando_pago
                FROM pedidos 
                WHERE DATE(timestamp) = '{hoy}'
                """
            
            pedidos = pd.read_sql_query(query_pedidos, conn)
        except:
            # Si no existe la tabla pedidos
            pedidos = pd.DataFrame([{
                'pedidos_hoy': 0,
                'ventas_hoy': 0,
                'comprobantes_recibidos': 0,
                'esperando_pago': 0
            }])
        
        return stats, pedidos
        
    except Exception as e:
        st.error(f"Error cargando estadísticas: {e}")
        return pd.DataFrame(), pd.DataFrame()

@st.cache_data(ttl=2)
def get_comprobantes_recientes():
    """Obtiene comprobantes recientes si están disponibles"""
    if estructura_bd['tiene_comprobante_url']:
        try:
            query = """
            SELECT 
                id, numero_telefono, nombre_cliente, total, 
                comprobante_url, timestamp, estado
            FROM pedidos 
            WHERE comprobante_url IS NOT NULL 
            ORDER BY timestamp DESC 
            LIMIT 10
            """
            return pd.read_sql_query(query, conn)
        except Exception as e:
            st.error(f"Error cargando comprobantes: {e}")
            return pd.DataFrame()
    else:
        return pd.DataFrame()

# Funciones auxiliares
def format_phone_number(numero):
    if numero and numero.startswith('whatsapp:'):
        numero = numero.replace('whatsapp:', '')
    return f"***{numero[-4:]}" if numero and len(numero) >= 4 else numero

def format_timestamp(timestamp_str):
    try:
        dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
        now = datetime.now()
        
        if dt.date() == now.date():
            return dt.strftime('%H:%M')
        elif dt.date() == (now - timedelta(days=1)).date():
            return f"Ayer {dt.strftime('%H:%M')}"
        else:
            return dt.strftime('%d/%m %H:%M')
    except:
        return timestamp_str

def mostrar_estado_pedido(estado, comprobante_recibido):
    if comprobante_recibido == 1:
        return '<span class="estado-comprobante">📸 Comprobante OK</span>'
    elif estado == 'esperando_pago':
        return '<span class="estado-esperando">⏳ Esperando pago</span>'
    elif estado == 'comprobante_recibido':
        return '<span class="estado-comprobante">📸 Comprobante recibido</span>'
    elif estado == 'completado':
        return '<span class="estado-completado">✅ Completado</span>'
    elif estado:
        return f'<span class="estado-esperando">{estado}</span>'
    else:
        return '<span class="estado-esperando">Sin pedido</span>'

# *** INTERFAZ PRINCIPAL ***

# Título principal
st.title("📱 Papanatas SPA - Chat en Vivo")

# Mostrar estado de la base de datos
if not estructura_bd['tiene_comprobante_recibido'] or not estructura_bd['tiene_comprobante_url']:
    st.warning("""
    ⚠️ **Base de datos incompleta**
    
    Algunas funciones de comprobantes no están disponibles. 
    Para habilitar todas las funciones, ejecuta el script de migración:
    
    ```bash
    node fix_database.js
    ```
    """)

# Sidebar con configuraciones
with st.sidebar:
    st.header("⚙️ Configuración")
    
    auto_refresh = st.checkbox("🔄 Auto-refresh", value=True)
    refresh_interval = st.slider("Intervalo (segundos)", 1, 10, 3)
    
    # Manual refresh button
    if st.button("🔄 Actualizar Ahora"):
        st.cache_data.clear()
        st.rerun()
    
    st.markdown("---")
    
    # Estado de la base de datos
    st.header("🗄️ Estado de BD")
    st.write(f"**Columnas disponibles:**")
    st.write(f"• comprobante_recibido: {'✅' if estructura_bd['tiene_comprobante_recibido'] else '❌'}")
    st.write(f"• comprobante_url: {'✅' if estructura_bd['tiene_comprobante_url'] else '❌'}")
    
    st.markdown("---")
    
    # Estadísticas generales
    try:
        stats, pedidos = get_estadisticas_generales()
        
        st.header("📊 Estadísticas Hoy")
        
        if len(stats) > 0:
            st.metric("💬 Conversaciones", stats.iloc[0]['conversaciones_hoy'])
            st.metric("📨 Mensajes", stats.iloc[0]['mensajes_hoy'])
        
        if len(pedidos) > 0:
            st.metric("🛒 Pedidos", pedidos.iloc[0]['pedidos_hoy'])
            st.metric("💰 Ventas", f"${pedidos.iloc[0]['ventas_hoy']:,.0f}")
            if estructura_bd['tiene_comprobante_recibido']:
                st.metric("📸 Comprobantes", pedidos.iloc[0]['comprobantes_recibidos'])
                st.metric("⏳ Pendientes", pedidos.iloc[0]['esperando_pago'])
        
    except Exception as e:
        st.error(f"Error cargando estadísticas: {str(e)}")
    
    st.markdown("---")
    
    # Sección de comprobantes recientes (solo si está disponible)
    if estructura_bd['tiene_comprobante_url']:
        st.header("📸 Comprobantes Recientes")
        try:
            comprobantes_df = get_comprobantes_recientes()
            if len(comprobantes_df) > 0:
                for i, row in comprobantes_df.iterrows():
                    cliente = row['nombre_cliente'] if row['nombre_cliente'] else "Cliente Anónimo"
                    timestamp = format_timestamp(row['timestamp'])
                    st.markdown(f"""
                    <div style="background-color: #f0f8ff; padding: 8px; border-radius: 5px; margin: 5px 0;">
                        <small><strong>{cliente}</strong><br>
                        💰 ${row['total']:,.0f} • {timestamp}<br>
                        📸 <a href="{row['comprobante_url']}" target="_blank">Ver comprobante</a></small>
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.info("No hay comprobantes recientes")
        except Exception as e:
            st.error(f"Error: {str(e)}")
    else:
        st.header("📸 Comprobantes")
        st.info("Función no disponible\n\nEjecuta la migración de BD")

# Auto-refresh logic
if auto_refresh:
    placeholder = st.empty()
    with placeholder.container():
        st.info(f"🔄 Auto-actualizando cada {refresh_interval} segundos...")
    time.sleep(refresh_interval)
    placeholder.empty()
    st.rerun()

# Layout principal
col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("👥 Conversaciones Activas")
    
    try:
        conversaciones_df = get_conversaciones_por_numero()
        
        if len(conversaciones_df) > 0:
            # Variable de estado para el contacto seleccionado
            if 'selected_contact' not in st.session_state:
                st.session_state.selected_contact = conversaciones_df.iloc[0]['numero_telefono']
            
            # Lista de contactos
            for i, row in conversaciones_df.iterrows():
                numero = row['numero_telefono']
                nombre = row['nombre_cliente'] if row['nombre_cliente'] else "Cliente Anónimo"
                ultima_actividad = format_timestamp(row['ultima_actividad'])
                total_mensajes = row['total_mensajes']
                
                # Información del pedido (si está disponible)
                estado_pedido = row.get('estado')
                comprobante_recibido = row.get('comprobante_recibido', 0)
                total_pedido = row.get('total')
                
                # Determinar si está activo
                is_active = (numero == st.session_state.selected_contact)
                
                # Crear texto del botón
                button_text = f"👤 {nombre}\n📱 {format_phone_number(numero)}\n🕐 {ultima_actividad} • {total_mensajes} msg"
                
                if total_pedido:
                    button_text += f"\n💰 ${total_pedido:,.0f}"
                
                if comprobante_recibido == 1:
                    button_text += " 📸"
                elif estado_pedido == 'esperando_pago':
                    button_text += " ⏳"
                
                # Botón para seleccionar contacto
                if st.button(
                    button_text,
                    key=f"contact_{i}",
                    use_container_width=True
                ):
                    st.session_state.selected_contact = numero
                    st.rerun()
                
                # Mostrar estado del pedido si existe
                if estado_pedido:
                    estado_html = mostrar_estado_pedido(estado_pedido, comprobante_recibido)
                    st.markdown(estado_html, unsafe_allow_html=True)
                
                if is_active:
                    st.markdown(f"<div style='border: 2px solid #25d366; border-radius: 8px; padding: 2px;'></div>", unsafe_allow_html=True)
                
                st.markdown("---")
        else:
            st.info("📭 No hay conversaciones registradas aún.")
            
    except Exception as e:
        st.error(f"Error cargando conversaciones: {str(e)}")

with col2:
    if 'selected_contact' in st.session_state:
        try:
            # Obtener mensajes del contacto seleccionado
            mensajes_df = get_mensajes_numero(st.session_state.selected_contact)
            
            if len(mensajes_df) > 0:
                # Obtener información del cliente
                conversaciones_df = get_conversaciones_por_numero()
                cliente_info = conversaciones_df[conversaciones_df['numero_telefono'] == st.session_state.selected_contact]
                
                if len(cliente_info) > 0:
                    nombre_cliente = cliente_info.iloc[0]['nombre_cliente']
                    estado_pedido = cliente_info.iloc[0].get('estado')
                    comprobante_recibido = cliente_info.iloc[0].get('comprobante_recibido', 0)
                    comprobante_url = cliente_info.iloc[0].get('comprobante_url')
                    total_pedido = cliente_info.iloc[0].get('total')
                    
                    # Header del chat
                    if nombre_cliente:
                        header_text = f"💬 Chat con {nombre_cliente}"
                    else:
                        header_text = f"💬 Chat con {format_phone_number(st.session_state.selected_contact)}"
                    
                    if total_pedido:
                        header_text += f" • 💰 ${total_pedido:,.0f}"
                    
                    st.subheader(header_text)
                    
                    # Mostrar estado del pedido
                    if estado_pedido:
                        col_estado, col_comprobante = st.columns([1, 1])
                        with col_estado:
                            estado_html = mostrar_estado_pedido(estado_pedido, comprobante_recibido)
                            st.markdown(f"**Estado:** {estado_html}", unsafe_allow_html=True)
                        
                        with col_comprobante:
                            if comprobante_url:
                                st.markdown(f"**Comprobante:** [📸 Ver imagen]({comprobante_url})")
                else:
                    st.subheader(f"💬 Chat con {format_phone_number(st.session_state.selected_contact)}")
                
                # Contenedor del chat
                st.markdown('<div class="chat-container">', unsafe_allow_html=True)
                
                # Mostrar mensajes
                for i, row in mensajes_df.iterrows():
                    timestamp = format_timestamp(row['timestamp'])
                    
                    # Mensaje del usuario
                    if row['mensaje_usuario'] and row['mensaje_usuario'].strip():
                        st.markdown(f"""
                        <div class="message-user">
                            <strong>📱 Cliente:</strong><br>
                            {row['mensaje_usuario']}
                            <div class="message-time">{timestamp}</div>
                        </div>
                        """, unsafe_allow_html=True)
                    
                    # Mensaje del bot
                    if row['mensaje_bot'] and row['mensaje_bot'].strip():
                        mensaje_bot = row['mensaje_bot'].replace('\n', '<br>')
                        st.markdown(f"""
                        <div class="message-bot">
                            <strong>🍟 Papanatas:</strong><br>
                            {mensaje_bot}
                            <div class="message-time">{timestamp}</div>
                        </div>
                        """, unsafe_allow_html=True)
                
                st.markdown('</div>', unsafe_allow_html=True)
                
                # Estado actual del flujo
                if len(mensajes_df) > 0:
                    ultimo_step = mensajes_df.iloc[-1]['step']
                    step_descriptions = {
                        'inicio': '🟢 Iniciando conversación',
                        'esperando_nombre': '✏️ Esperando nombre',
                        'esperando_tamaño': '🍟 Seleccionando tamaño',
                        'esperando_agregado_opcion': '🧀 Preguntando agregado',
                        'esperando_tipo_agregado': '➕ Seleccionando agregado',
                        'esperando_bebida': '🥤 Preguntando bebida',
                        'esperando_confirmacion_final': '✅ Confirmando pedido',
                        'modificando_pedido': '🔄 Modificando pedido',
                        'esperando_comprobante': '📱 Esperando comprobante',
                        'pedido_completado': '🎉 Pedido completado'
                    }
                    
                    estado_actual = step_descriptions.get(ultimo_step, f"📍 {ultimo_step}")
                    st.info(f"**Estado del flujo:** {estado_actual}")
                
            else:
                st.info("📭 No hay mensajes en esta conversación.")
                
        except Exception as e:
            st.error(f"Error cargando mensajes: {str(e)}")
    else:
        st.info("👆 Selecciona una conversación para ver los mensajes")

# Footer con información del sistema
st.markdown("---")
col1, col2, col3, col4 = st.columns(4)

with col1:
    st.markdown("🟢 **Sistema Activo**")
    st.caption(f"Actualizado: {datetime.now().strftime('%H:%M:%S')}")

with col2:
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM conversaciones")
        total_mensajes = cursor.fetchone()[0]
        st.markdown(f"💬 **{total_mensajes} mensajes**")
        st.caption("Total en base de datos")
    except:
        st.markdown("❌ **Error BD**")

with col3:
    if estructura_bd['tiene_comprobante_recibido']:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM pedidos WHERE comprobante_recibido = 1")
            total_comprobantes = cursor.fetchone()[0]
            st.markdown(f"📸 **{total_comprobantes} comprobantes**")
            st.caption("Recibidos correctamente")
        except:
            st.markdown("❌ **Error comprobantes**")
    else:
        st.markdown("📸 **Comprobantes**")
        st.caption("No disponible")

with col4:
    st.markdown("🍟 **Papanatas SPA**")
    st.caption("Dashboard WhatsApp v2.1")