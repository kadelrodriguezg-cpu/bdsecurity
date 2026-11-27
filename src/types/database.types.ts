export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          accion: string
          campos_expuestos: string[]
          detalle: Json
          id: number
          ocurrido_en: string
          planta_id: string | null
          usuario_id: string | null
        }
        Insert: {
          accion: string
          campos_expuestos?: string[]
          detalle?: Json
          id?: never
          ocurrido_en?: string
          planta_id?: string | null
          usuario_id?: string | null
        }
        Update: {
          accion?: string
          campos_expuestos?: string[]
          detalle?: Json
          id?: never
          ocurrido_en?: string
          planta_id?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      baja_motivo: {
        Row: {
          created_at: string
          created_by: string | null
          criterio: Database["public"]["Enums"]["criterio_baja"]
          id: string
          idempotency_key: string
          individuo_id: string
          nota: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          criterio: Database["public"]["Enums"]["criterio_baja"]
          id?: string
          idempotency_key?: string
          individuo_id: string
          nota?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          criterio?: Database["public"]["Enums"]["criterio_baja"]
          id?: string
          idempotency_key?: string
          individuo_id?: string
          nota?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "baja_motivo_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baja_motivo_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_canal_participantes: {
        Row: {
          agregado_at: string
          agregado_por: string | null
          canal_id: string
          usuario_id: string
        }
        Insert: {
          agregado_at?: string
          agregado_por?: string | null
          canal_id: string
          usuario_id: string
        }
        Update: {
          agregado_at?: string
          agregado_por?: string | null
          canal_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_canal_participantes_agregado_por_fkey"
            columns: ["agregado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_canal_participantes_canal_id_fkey"
            columns: ["canal_id"]
            isOneToOne: false
            referencedRelation: "chat_canales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_canal_participantes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_canales: {
        Row: {
          archivado_at: string | null
          creado_at: string
          creado_por: string | null
          entidad_id: string | null
          entidad_nombre: string | null
          id: string
          oculto_desde: number
          tipo: string
          ultima_actividad_at: string
          ultima_posicion: number
        }
        Insert: {
          archivado_at?: string | null
          creado_at?: string
          creado_por?: string | null
          entidad_id?: string | null
          entidad_nombre?: string | null
          id?: string
          oculto_desde?: number
          tipo: string
          ultima_actividad_at?: string
          ultima_posicion?: number
        }
        Update: {
          archivado_at?: string | null
          creado_at?: string
          creado_por?: string | null
          entidad_id?: string | null
          entidad_nombre?: string | null
          id?: string
          oculto_desde?: number
          tipo?: string
          ultima_actividad_at?: string
          ultima_posicion?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_canales_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_lecturas: {
        Row: {
          actualizado_at: string
          canal_id: string
          ultima_posicion: number
          usuario_id: string
        }
        Insert: {
          actualizado_at?: string
          canal_id: string
          ultima_posicion: number
          usuario_id: string
        }
        Update: {
          actualizado_at?: string
          canal_id?: string
          ultima_posicion?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_lecturas_canal_id_fkey"
            columns: ["canal_id"]
            isOneToOne: false
            referencedRelation: "chat_canales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_lecturas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_menciones: {
        Row: {
          creado_at: string
          leida_at: string | null
          mensaje_id: string
          tipo: string
          usuario_id: string
        }
        Insert: {
          creado_at?: string
          leida_at?: string | null
          mensaje_id: string
          tipo: string
          usuario_id: string
        }
        Update: {
          creado_at?: string
          leida_at?: string | null
          mensaje_id?: string
          tipo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_menciones_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "chat_mensajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_menciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mensajes: {
        Row: {
          autor_id: string | null
          autor_nombre: string
          canal_id: string
          clave_envio: string
          contenido: string
          creado_at: string
          id: string
          posicion: number
        }
        Insert: {
          autor_id?: string | null
          autor_nombre: string
          canal_id: string
          clave_envio: string
          contenido: string
          creado_at?: string
          id?: string
          posicion: number
        }
        Update: {
          autor_id?: string | null
          autor_nombre?: string
          canal_id?: string
          clave_envio?: string
          contenido?: string
          creado_at?: string
          id?: string
          posicion?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_mensajes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mensajes_canal_id_fkey"
            columns: ["canal_id"]
            isOneToOne: false
            referencedRelation: "chat_canales"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion_ranking: {
        Row: {
          cobertura_advertencia: number
          id: number
          minimo_evaluaciones_grupo: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cobertura_advertencia?: number
          id?: number
          minimo_evaluaciones_grupo?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cobertura_advertencia?: number
          id?: number
          minimo_evaluaciones_grupo?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_ranking_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contenedor: {
        Row: {
          activo: boolean
          capacidad_litros: number | null
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          capacidad_litros?: number | null
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          capacidad_litros?: number | null
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      cosecha_fruto: {
        Row: {
          cantidad_semillas: number
          created_at: string
          created_by: string | null
          id: string
          numero_fruto: number
          planta_id: string
        }
        Insert: {
          cantidad_semillas: number
          created_at?: string
          created_by?: string | null
          id?: string
          numero_fruto: number
          planta_id: string
        }
        Update: {
          cantidad_semillas?: number
          created_at?: string
          created_by?: string | null
          id?: string
          numero_fruto?: number
          planta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cosecha_fruto_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cosecha_fruto_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cosecha_fruto_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      emplazamiento_coordenada: {
        Row: {
          created_at: string
          created_by: string | null
          emplazamiento_id: string
          latitud: number | null
          longitud: number | null
          precision_metros: number | null
          ubicacion_exacta: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          emplazamiento_id: string
          latitud?: number | null
          longitud?: number | null
          precision_metros?: number | null
          ubicacion_exacta?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          emplazamiento_id?: string
          latitud?: number | null
          longitud?: number | null
          precision_metros?: number | null
          ubicacion_exacta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emplazamiento_coordenada_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emplazamiento_coordenada_emplazamiento_id_fkey"
            columns: ["emplazamiento_id"]
            isOneToOne: true
            referencedRelation: "emplazamiento_individuo"
            referencedColumns: ["id"]
          },
        ]
      }
      emplazamiento_individuo: {
        Row: {
          created_at: string
          created_by: string | null
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          individuo_id: string
          referencia_operativa: string | null
          sector_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          individuo_id: string
          referencia_operativa?: string | null
          sector_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          individuo_id?: string
          referencia_operativa?: string | null
          sector_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emplazamiento_individuo_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emplazamiento_individuo_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emplazamiento_individuo_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sector"
            referencedColumns: ["id"]
          },
        ]
      }
      especies: {
        Row: {
          created_at: string
          id: string
          nombre: string
          nombre_cientifico: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          nombre_cientifico?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          nombre_cientifico?: string | null
        }
        Relationships: []
      }
      esquema_campo_especie: {
        Row: {
          activo: boolean
          clave: string
          especie_id: string
          etiquetas_nivel: string[] | null
          fase: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activo?: boolean
          clave: string
          especie_id: string
          etiquetas_nivel?: string[] | null
          fase: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activo?: boolean
          clave?: string
          especie_id?: string
          etiquetas_nivel?: string[] | null
          fase?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esquema_campo_especie_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esquema_campo_especie_fase_clave_fkey"
            columns: ["fase", "clave"]
            isOneToOne: false
            referencedRelation: "esquema_fase_campo"
            referencedColumns: ["fase", "clave"]
          },
          {
            foreignKeyName: "esquema_campo_especie_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esquema_fase_campo: {
        Row: {
          activo: boolean
          clave: string
          escala_maximo: number | null
          escala_minimo: number | null
          etiqueta: string
          etiqueta_maximo: string | null
          etiqueta_minimo: string | null
          etiquetas_nivel: string[] | null
          exige_muestra: boolean
          fase: string
          orden: number
          rol: string
          seccion: string
          tipo: string
          unidad: string | null
          vigente_desde: string | null
        }
        Insert: {
          activo?: boolean
          clave: string
          escala_maximo?: number | null
          escala_minimo?: number | null
          etiqueta: string
          etiqueta_maximo?: string | null
          etiqueta_minimo?: string | null
          etiquetas_nivel?: string[] | null
          exige_muestra?: boolean
          fase: string
          orden: number
          rol: string
          seccion: string
          tipo: string
          unidad?: string | null
          vigente_desde?: string | null
        }
        Update: {
          activo?: boolean
          clave?: string
          escala_maximo?: number | null
          escala_minimo?: number | null
          etiqueta?: string
          etiqueta_maximo?: string | null
          etiqueta_minimo?: string | null
          etiquetas_nivel?: string[] | null
          exige_muestra?: boolean
          fase?: string
          orden?: number
          rol?: string
          seccion?: string
          tipo?: string
          unidad?: string | null
          vigente_desde?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esquema_fase_campo_fase_seccion_fkey"
            columns: ["fase", "seccion"]
            isOneToOne: false
            referencedRelation: "esquema_fase_seccion"
            referencedColumns: ["fase", "id"]
          },
        ]
      }
      esquema_fase_seccion: {
        Row: {
          etiqueta: string
          fase: string
          id: string
          orden: number
        }
        Insert: {
          etiqueta: string
          fase: string
          id: string
          orden: number
        }
        Update: {
          etiqueta?: string
          fase?: string
          id?: string
          orden?: number
        }
        Relationships: []
      }
      evaluacion_reducida: {
        Row: {
          created_at: string
          created_by: string | null
          fase: Database["public"]["Enums"]["fase_evaluacion_reducida"]
          id: string
          individuo_id: string
          multibrotes: number | null
          numero_entrenudos: number | null
          observaciones: string | null
          presencia_raices: number | null
          talla: number | null
          vigor: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fase: Database["public"]["Enums"]["fase_evaluacion_reducida"]
          id?: string
          individuo_id: string
          multibrotes?: number | null
          numero_entrenudos?: number | null
          observaciones?: string | null
          presencia_raices?: number | null
          talla?: number | null
          vigor?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fase?: Database["public"]["Enums"]["fase_evaluacion_reducida"]
          id?: string
          individuo_id?: string
          multibrotes?: number | null
          numero_entrenudos?: number | null
          observaciones?: string | null
          presencia_raices?: number | null
          talla?: number | null
          vigor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluacion_reducida_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluacion_reducida_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluaciones: {
        Row: {
          altura_brote_mm: number | null
          anio: number
          bloom: number | null
          brix: number | null
          cicatriz: number | null
          brotacion: number | null
          caida_fruto: number | null
          calibre_mm: number | null
          cantidad_frutos: number | null
          capturada_at: string
          color: number | null
          color_follaje: number | null
          concentracion_cosecha: number | null
          created_at: string
          created_by: string | null
          cuaja: number | null
          dano_calor: number | null
          diametro_brote_mm: number | null
          distribucion_flores_frutos: number | null
          estado: Database["public"]["Enums"]["estado_evaluacion"]
          evaluador: string | null
          fecha: string
          fecha_inicio_floracion: string | null
          firmeza: number | null
          floracion: number | null
          golpe_sol: number | null
          id: string
          idempotency_key: string
          motivo_cambio: string | null
          n_flores_varas_basales: number | null
          n_frutos_varas_basales: number | null
          n_varas_basales: number | null
          n_varas_con_flor: number | null
          no_comparable: boolean
          observaciones: string | null
          pct_buen_estado_15d: number | null
          pct_buen_estado_30d: number | null
          pct_buen_estado_45d: number | null
          pct_flores: number | null
          pct_fruta_exportable: number | null
          pct_frutos: number | null
          peso_promedio_g: number | null
          peso_total_g: number | null
          precocidad: number | null
          predio_id: string | null
          presencia_yemas_florales: number | null
          protocolo_id: string | null
          rend_kg_planta: number | null
          rend_t_ha: number | null
          requiere_revision: boolean
          ronda_id: string
          sin_muestra: boolean
          updated_at: string
          vigor_vegetativo: number | null
        }
        Insert: {
          altura_brote_mm?: number | null
          anio?: number
          bloom?: number | null
          brix?: number | null
          cicatriz?: number | null
          brotacion?: number | null
          caida_fruto?: number | null
          calibre_mm?: number | null
          cantidad_frutos?: number | null
          capturada_at?: string
          color?: number | null
          color_follaje?: number | null
          concentracion_cosecha?: number | null
          created_at?: string
          created_by?: string | null
          cuaja?: number | null
          dano_calor?: number | null
          diametro_brote_mm?: number | null
          distribucion_flores_frutos?: number | null
          estado?: Database["public"]["Enums"]["estado_evaluacion"]
          evaluador?: string | null
          fecha: string
          fecha_inicio_floracion?: string | null
          firmeza?: number | null
          floracion?: number | null
          golpe_sol?: number | null
          id?: string
          idempotency_key?: string
          motivo_cambio?: string | null
          n_flores_varas_basales?: number | null
          n_frutos_varas_basales?: number | null
          n_varas_basales?: number | null
          n_varas_con_flor?: number | null
          no_comparable?: boolean
          observaciones?: string | null
          pct_buen_estado_15d?: number | null
          pct_buen_estado_30d?: number | null
          pct_buen_estado_45d?: number | null
          pct_flores?: number | null
          pct_fruta_exportable?: number | null
          pct_frutos?: number | null
          peso_promedio_g?: number | null
          peso_total_g?: number | null
          precocidad?: number | null
          predio_id?: string | null
          presencia_yemas_florales?: number | null
          protocolo_id?: string | null
          rend_kg_planta?: number | null
          rend_t_ha?: number | null
          requiere_revision?: boolean
          ronda_id: string
          sin_muestra?: boolean
          updated_at?: string
          vigor_vegetativo?: number | null
        }
        Update: {
          altura_brote_mm?: number | null
          anio?: number
          bloom?: number | null
          brix?: number | null
          cicatriz?: number | null
          brotacion?: number | null
          caida_fruto?: number | null
          calibre_mm?: number | null
          cantidad_frutos?: number | null
          capturada_at?: string
          color?: number | null
          color_follaje?: number | null
          concentracion_cosecha?: number | null
          created_at?: string
          created_by?: string | null
          cuaja?: number | null
          dano_calor?: number | null
          diametro_brote_mm?: number | null
          distribucion_flores_frutos?: number | null
          estado?: Database["public"]["Enums"]["estado_evaluacion"]
          evaluador?: string | null
          fecha?: string
          fecha_inicio_floracion?: string | null
          firmeza?: number | null
          floracion?: number | null
          golpe_sol?: number | null
          id?: string
          idempotency_key?: string
          motivo_cambio?: string | null
          n_flores_varas_basales?: number | null
          n_frutos_varas_basales?: number | null
          n_varas_basales?: number | null
          n_varas_con_flor?: number | null
          no_comparable?: boolean
          observaciones?: string | null
          pct_buen_estado_15d?: number | null
          pct_buen_estado_30d?: number | null
          pct_buen_estado_45d?: number | null
          pct_flores?: number | null
          pct_fruta_exportable?: number | null
          pct_frutos?: number | null
          peso_promedio_g?: number | null
          peso_total_g?: number | null
          precocidad?: number | null
          predio_id?: string | null
          presencia_yemas_florales?: number | null
          protocolo_id?: string | null
          rend_kg_planta?: number | null
          rend_t_ha?: number | null
          requiere_revision?: boolean
          ronda_id?: string
          sin_muestra?: boolean
          updated_at?: string
          vigor_vegetativo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluaciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluaciones_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolo_ronda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluaciones_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "ronda_evaluacion_anual"
            referencedColumns: ["id"]
          },
        ]
      }
      evecl_descriptor: {
        Row: {
          activo: boolean
          codigo_upov: number | null
          direccion_ranking: string | null
          eje: Database["public"]["Enums"]["evecl_eje"]
          id: number
          nombre: string
          nota_especial: string | null
          orden: number
          rankeable: boolean
          tipo: Database["public"]["Enums"]["evecl_tipo_descriptor"]
          unidad: string | null
        }
        Insert: {
          activo?: boolean
          codigo_upov?: number | null
          direccion_ranking?: string | null
          eje: Database["public"]["Enums"]["evecl_eje"]
          id?: never
          nombre: string
          nota_especial?: string | null
          orden: number
          rankeable?: boolean
          tipo: Database["public"]["Enums"]["evecl_tipo_descriptor"]
          unidad?: string | null
        }
        Update: {
          activo?: boolean
          codigo_upov?: number | null
          direccion_ranking?: string | null
          eje?: Database["public"]["Enums"]["evecl_eje"]
          id?: never
          nombre?: string
          nota_especial?: string | null
          orden?: number
          rankeable?: boolean
          tipo?: Database["public"]["Enums"]["evecl_tipo_descriptor"]
          unidad?: string | null
        }
        Relationships: []
      }
      evecl_descriptor_estado: {
        Row: {
          descriptor_id: number
          id: number
          label: string
          nota: number
          orden: number
        }
        Insert: {
          descriptor_id: number
          id?: never
          label: string
          nota: number
          orden: number
        }
        Update: {
          descriptor_id?: number
          id?: never
          label?: string
          nota?: number
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "evecl_descriptor_estado_descriptor_id_fkey"
            columns: ["descriptor_id"]
            isOneToOne: false
            referencedRelation: "evecl_descriptor"
            referencedColumns: ["id"]
          },
        ]
      }
      evecl_ensayo: {
        Row: {
          activo: boolean
          area_evaluada: string | null
          codigo_parcela: string
          created_at: string
          created_by: string
          direccion: string | null
          eliminado_at: string | null
          empresa: string | null
          encargado_predio: string | null
          id: number
          latitud: number | null
          localidad: string | null
          longitud: number | null
          nombre_productor: string | null
          notas: string | null
        }
        Insert: {
          activo?: boolean
          area_evaluada?: string | null
          codigo_parcela: string
          created_at?: string
          created_by?: string
          direccion?: string | null
          eliminado_at?: string | null
          empresa?: string | null
          encargado_predio?: string | null
          id?: never
          latitud?: number | null
          localidad?: string | null
          longitud?: number | null
          nombre_productor?: string | null
          notas?: string | null
        }
        Update: {
          activo?: boolean
          area_evaluada?: string | null
          codigo_parcela?: string
          created_at?: string
          created_by?: string
          direccion?: string | null
          eliminado_at?: string | null
          empresa?: string | null
          encargado_predio?: string | null
          id?: never
          latitud?: number | null
          localidad?: string | null
          longitud?: number | null
          nombre_productor?: string | null
          notas?: string | null
        }
        Relationships: []
      }
      evecl_ficha: {
        Row: {
          codigo_genotipo: string | null
          codigo_planta: string | null
          created_at: string
          created_by: string
          eliminado_at: string | null
          encargado: string | null
          ensayo_id: number
          fecha_evaluacion: string
          fecha_siembra: string | null
          id: number
          idempotency_key: string
          notas: string | null
          numero_repeticion: number
          origen_cruza: string | null
          tipo: Database["public"]["Enums"]["evecl_tipo_ficha"]
          updated_at: string
          variedad: string
        }
        Insert: {
          codigo_genotipo?: string | null
          codigo_planta?: string | null
          created_at?: string
          created_by?: string
          eliminado_at?: string | null
          encargado?: string | null
          ensayo_id: number
          fecha_evaluacion?: string
          fecha_siembra?: string | null
          id?: never
          idempotency_key?: string
          notas?: string | null
          numero_repeticion: number
          origen_cruza?: string | null
          tipo?: Database["public"]["Enums"]["evecl_tipo_ficha"]
          updated_at?: string
          variedad: string
        }
        Update: {
          codigo_genotipo?: string | null
          codigo_planta?: string | null
          created_at?: string
          created_by?: string
          eliminado_at?: string | null
          encargado?: string | null
          ensayo_id?: number
          fecha_evaluacion?: string
          fecha_siembra?: string | null
          id?: never
          idempotency_key?: string
          notas?: string | null
          numero_repeticion?: number
          origen_cruza?: string | null
          tipo?: Database["public"]["Enums"]["evecl_tipo_ficha"]
          updated_at?: string
          variedad?: string
        }
        Relationships: [
          {
            foreignKeyName: "evecl_ficha_ensayo_id_fkey"
            columns: ["ensayo_id"]
            isOneToOne: false
            referencedRelation: "evecl_ensayo"
            referencedColumns: ["id"]
          },
        ]
      }
      evecl_respuesta: {
        Row: {
          created_at: string
          descriptor_id: number
          fecha_observada: string | null
          ficha_id: number
          foto_path: string | null
          id: number
          nota: number | null
          updated_at: string
          valor_numerico: number | null
          valor_texto: string | null
        }
        Insert: {
          created_at?: string
          descriptor_id: number
          fecha_observada?: string | null
          ficha_id: number
          foto_path?: string | null
          id?: never
          nota?: number | null
          updated_at?: string
          valor_numerico?: number | null
          valor_texto?: string | null
        }
        Update: {
          created_at?: string
          descriptor_id?: number
          fecha_observada?: string | null
          ficha_id?: number
          foto_path?: string | null
          id?: never
          nota?: number | null
          updated_at?: string
          valor_numerico?: number | null
          valor_texto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evecl_respuesta_descriptor_id_fkey"
            columns: ["descriptor_id"]
            isOneToOne: false
            referencedRelation: "evecl_descriptor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evecl_respuesta_ficha_id_fkey"
            columns: ["ficha_id"]
            isOneToOne: false
            referencedRelation: "evecl_ficha"
            referencedColumns: ["id"]
          },
        ]
      }
      evento_archivos: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          registro_id: string
          storage_path: string
          tipo: Database["public"]["Enums"]["tipo_archivo"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          registro_id: string
          storage_path: string
          tipo: Database["public"]["Enums"]["tipo_archivo"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          registro_id?: string
          storage_path?: string
          tipo?: Database["public"]["Enums"]["tipo_archivo"]
        }
        Relationships: [
          {
            foreignKeyName: "evento_archivos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evento_archivos_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros_evento"
            referencedColumns: ["id"]
          },
        ]
      }
      germinacion_evento: {
        Row: {
          cantidad_nueva: number
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          planta_id: string
        }
        Insert: {
          cantidad_nueva: number
          created_at?: string
          created_by?: string | null
          fecha: string
          id?: string
          planta_id: string
        }
        Update: {
          cantidad_nueva?: number
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          planta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "germinacion_evento_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "germinacion_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "germinacion_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      importacion_lote: {
        Row: {
          archivo_nombre: string
          caduca_at: string
          confirmado_at: string | null
          created_at: string
          created_by: string
          cruces_creados: number
          estado: string
          filas: Json
          filas_con_error: number
          filas_total: number
          id: string
          idempotency_key: string | null
          revertido_at: string | null
          variedades_creadas: number
        }
        Insert: {
          archivo_nombre: string
          caduca_at?: string
          confirmado_at?: string | null
          created_at?: string
          created_by: string
          cruces_creados?: number
          estado?: string
          filas: Json
          filas_con_error?: number
          filas_total: number
          id?: string
          idempotency_key?: string | null
          revertido_at?: string | null
          variedades_creadas?: number
        }
        Update: {
          archivo_nombre?: string
          caduca_at?: string
          confirmado_at?: string | null
          created_at?: string
          created_by?: string
          cruces_creados?: number
          estado?: string
          filas?: Json
          filas_con_error?: number
          filas_total?: number
          id?: string
          idempotency_key?: string | null
          revertido_at?: string | null
          variedades_creadas?: number
        }
        Relationships: [
          {
            foreignKeyName: "importacion_lote_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      individuos: {
        Row: {
          clon_de_id: string | null
          codigo_display: string
          created_at: string
          created_by: string
          estado_vital: Database["public"]["Enums"]["estado_vital"]
          fecha_baja: string | null
          fecha_individualizacion: string
          id: string
          planta_id: string
          updated_at: string
        }
        Insert: {
          clon_de_id?: string | null
          codigo_display: string
          created_at?: string
          created_by: string
          estado_vital?: Database["public"]["Enums"]["estado_vital"]
          fecha_baja?: string | null
          fecha_individualizacion?: string
          id?: string
          planta_id: string
          updated_at?: string
        }
        Update: {
          clon_de_id?: string | null
          codigo_display?: string
          created_at?: string
          created_by?: string
          estado_vital?: Database["public"]["Enums"]["estado_vital"]
          fecha_baja?: string | null
          fecha_individualizacion?: string
          id?: string
          planta_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "individuos_clon_de_id_fkey"
            columns: ["clon_de_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "individuos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "individuos_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "individuos_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      insumo: {
        Row: {
          activo: boolean
          id: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_insumo"]
        }
        Insert: {
          activo?: boolean
          id?: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_insumo"]
        }
        Update: {
          activo?: boolean
          id?: string
          nombre?: string
          tipo?: Database["public"]["Enums"]["tipo_insumo"]
        }
        Relationships: []
      }
      multisitio: {
        Row: {
          created_at: string
          created_by: string | null
          destino: string | null
          fecha_traslado: string | null
          id: string
          individuo_id: string
          observaciones: string | null
          predio_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          destino?: string | null
          fecha_traslado?: string | null
          id?: string
          individuo_id: string
          observaciones?: string | null
          predio_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          destino?: string | null
          fecha_traslado?: string | null
          id?: string
          individuo_id?: string
          observaciones?: string | null
          predio_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "multisitio_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "multisitio_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: true
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "multisitio_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
        ]
      }
      pcr_analisis: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string | null
          id: string
          idempotency_key: string
          informe_pdf_url: string | null
          realizado: boolean
          ronda_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha?: string | null
          id?: string
          idempotency_key?: string
          informe_pdf_url?: string | null
          realizado: boolean
          ronda_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string | null
          id?: string
          idempotency_key?: string
          informe_pdf_url?: string | null
          realizado?: boolean
          ronda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcr_analisis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcr_analisis_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "ronda_evaluacion_anual"
            referencedColumns: ["id"]
          },
        ]
      }
      perfiles: {
        Row: {
          created_at: string
          id: string
          nombre: string
          puede_ver_linaje: boolean
          rol: Database["public"]["Enums"]["rol_usuario"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          nombre: string
          puede_ver_linaje?: boolean
          rol?: Database["public"]["Enums"]["rol_usuario"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          puede_ver_linaje?: boolean
          rol?: Database["public"]["Enums"]["rol_usuario"]
          updated_at?: string
        }
        Relationships: []
      }
      plantas: {
        Row: {
          codigo_sistema: string
          contenedor_id: string | null
          created_at: string
          cruzamiento: string | null
          eliminado_at: string | null
          es_prueba: boolean
          escarificacion_duracion_dias: number | null
          escarificacion_subtipo:
            | Database["public"]["Enums"]["escarificacion_subtipo"]
            | null
          especie_id: string
          estado: Database["public"]["Enums"]["estado_planta"]
          fecha_cambio_estado: string
          fecha_cosecha: string | null
          fecha_polinizacion: string | null
          genetica_a: string | null
          genetica_b: string | null
          id: string
          lote_importacion_id: string | null
          mama: string | null
          mama_id: string | null
          n_flores_cruzadas: number | null
          n_semillas: number | null
          numero_notion_legacy: number | null
          papa: string | null
          papa_id: string | null
          predio_id: string | null
          semillas_sembradas: number | null
          updated_at: string
        }
        Insert: {
          codigo_sistema: string
          contenedor_id?: string | null
          created_at?: string
          cruzamiento?: string | null
          eliminado_at?: string | null
          es_prueba?: boolean
          escarificacion_duracion_dias?: number | null
          escarificacion_subtipo?:
            | Database["public"]["Enums"]["escarificacion_subtipo"]
            | null
          especie_id: string
          estado?: Database["public"]["Enums"]["estado_planta"]
          fecha_cambio_estado?: string
          fecha_cosecha?: string | null
          fecha_polinizacion?: string | null
          genetica_a?: string | null
          genetica_b?: string | null
          id?: string
          lote_importacion_id?: string | null
          mama?: string | null
          mama_id?: string | null
          n_flores_cruzadas?: number | null
          n_semillas?: number | null
          numero_notion_legacy?: number | null
          papa?: string | null
          papa_id?: string | null
          predio_id?: string | null
          semillas_sembradas?: number | null
          updated_at?: string
        }
        Update: {
          codigo_sistema?: string
          contenedor_id?: string | null
          created_at?: string
          cruzamiento?: string | null
          eliminado_at?: string | null
          es_prueba?: boolean
          escarificacion_duracion_dias?: number | null
          escarificacion_subtipo?:
            | Database["public"]["Enums"]["escarificacion_subtipo"]
            | null
          especie_id?: string
          estado?: Database["public"]["Enums"]["estado_planta"]
          fecha_cambio_estado?: string
          fecha_cosecha?: string | null
          fecha_polinizacion?: string | null
          genetica_a?: string | null
          genetica_b?: string | null
          id?: string
          lote_importacion_id?: string | null
          mama?: string | null
          mama_id?: string | null
          n_flores_cruzadas?: number | null
          n_semillas?: number | null
          numero_notion_legacy?: number | null
          papa?: string | null
          papa_id?: string | null
          predio_id?: string | null
          semillas_sembradas?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantas_contenedor_id_fkey"
            columns: ["contenedor_id"]
            isOneToOne: false
            referencedRelation: "contenedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_lote_importacion_id_fkey"
            columns: ["lote_importacion_id"]
            isOneToOne: false
            referencedRelation: "importacion_lote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_mama_id_fkey"
            columns: ["mama_id"]
            isOneToOne: false
            referencedRelation: "variedades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_papa_id_fkey"
            columns: ["papa_id"]
            isOneToOne: false
            referencedRelation: "variedades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
        ]
      }
      plantas_insumo: {
        Row: {
          insumo_id: string
          planta_id: string
        }
        Insert: {
          insumo_id: string
          planta_id: string
        }
        Update: {
          insumo_id?: string
          planta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantas_insumo_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_insumo_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_insumo_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      plantas_sustrato: {
        Row: {
          planta_id: string
          porcentaje: number
          sustrato_id: string
        }
        Insert: {
          planta_id: string
          porcentaje: number
          sustrato_id: string
        }
        Update: {
          planta_id?: string
          porcentaje?: number
          sustrato_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantas_sustrato_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_sustrato_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantas_sustrato_sustrato_id_fkey"
            columns: ["sustrato_id"]
            isOneToOne: false
            referencedRelation: "sustrato"
            referencedColumns: ["id"]
          },
        ]
      }
      polinizacion_evento: {
        Row: {
          created_at: string
          created_by: string | null
          es_reconstruccion: boolean
          fecha: string
          id: string
          n_flores_cruzadas: number
          planta_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          es_reconstruccion?: boolean
          fecha: string
          id?: string
          n_flores_cruzadas: number
          planta_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          es_reconstruccion?: boolean
          fecha?: string
          id?: string
          n_flores_cruzadas?: number
          planta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "polinizacion_evento_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polinizacion_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polinizacion_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      predio: {
        Row: {
          activo: boolean
          id: string
          latitud: number | null
          longitud: number | null
          nombre: string
          region: Database["public"]["Enums"]["region_chile"] | null
          sitio_id: string
        }
        Insert: {
          activo?: boolean
          id?: string
          latitud?: number | null
          longitud?: number | null
          nombre: string
          region?: Database["public"]["Enums"]["region_chile"] | null
          sitio_id?: string
        }
        Update: {
          activo?: boolean
          id?: string
          latitud?: number | null
          longitud?: number | null
          nombre?: string
          region?: Database["public"]["Enums"]["region_chile"] | null
          sitio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predio_sitio_id_fkey"
            columns: ["sitio_id"]
            isOneToOne: false
            referencedRelation: "sitio"
            referencedColumns: ["id"]
          },
        ]
      }
      predio_clima_mensual: {
        Row: {
          anio: number
          dias_helada: number | null
          fuente: string
          horas_sol_acumuladas: number | null
          id: string
          mes: number
          precipitacion_mm: number | null
          predio_id: string
          sincronizado_at: string
          temp_max_promedio: number | null
          temp_min_promedio: number | null
        }
        Insert: {
          anio: number
          dias_helada?: number | null
          fuente?: string
          horas_sol_acumuladas?: number | null
          id?: string
          mes: number
          precipitacion_mm?: number | null
          predio_id: string
          sincronizado_at?: string
          temp_max_promedio?: number | null
          temp_min_promedio?: number | null
        }
        Update: {
          anio?: number
          dias_helada?: number | null
          fuente?: string
          horas_sol_acumuladas?: number | null
          id?: string
          mes?: number
          precipitacion_mm?: number | null
          predio_id?: string
          sincronizado_at?: string
          temp_max_promedio?: number | null
          temp_min_promedio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "predio_clima_mensual_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
        ]
      }
      predio_clima_sync_pendiente: {
        Row: {
          created_at: string
          fecha_desde: string
          fecha_hasta: string
          intentos: number
          predio_id: string
          request_id: number
        }
        Insert: {
          created_at?: string
          fecha_desde: string
          fecha_hasta: string
          intentos?: number
          predio_id: string
          request_id: number
        }
        Update: {
          created_at?: string
          fecha_desde?: string
          fecha_hasta?: string
          intentos?: number
          predio_id?: string
          request_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "predio_clima_sync_pendiente_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimiento_cultivo: {
        Row: {
          cantidad: number | null
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          insumo_id: string | null
          notas: string | null
          planta_id: string
          tipo: Database["public"]["Enums"]["tipo_procedimiento_cultivo"]
        }
        Insert: {
          cantidad?: number | null
          created_at?: string
          created_by?: string | null
          fecha: string
          id?: string
          insumo_id?: string | null
          notas?: string | null
          planta_id: string
          tipo: Database["public"]["Enums"]["tipo_procedimiento_cultivo"]
        }
        Update: {
          cantidad?: number | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          insumo_id?: string | null
          notas?: string | null
          planta_id?: string
          tipo?: Database["public"]["Enums"]["tipo_procedimiento_cultivo"]
        }
        Relationships: [
          {
            foreignKeyName: "procedimiento_cultivo_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_cultivo_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_cultivo_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_cultivo_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimiento_insumos: {
        Row: {
          cantidad: number
          id: string
          insumo_id: string
          procedimiento_id: string
          unidad: string | null
        }
        Insert: {
          cantidad: number
          id?: string
          insumo_id: string
          procedimiento_id: string
          unidad?: string | null
        }
        Update: {
          cantidad?: number
          id?: string
          insumo_id?: string
          procedimiento_id?: string
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedimiento_insumos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_insumos_procedimiento_id_fkey"
            columns: ["procedimiento_id"]
            isOneToOne: false
            referencedRelation: "procedimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimiento_objetivos: {
        Row: {
          created_at: string
          id: string
          individuo_id: string | null
          nota: string | null
          planta_id: string | null
          predio_id: string | null
          procedimiento_id: string
          tipo: Database["public"]["Enums"]["tipo_objetivo_procedimiento"]
        }
        Insert: {
          created_at?: string
          id?: string
          individuo_id?: string | null
          nota?: string | null
          planta_id?: string | null
          predio_id?: string | null
          procedimiento_id: string
          tipo: Database["public"]["Enums"]["tipo_objetivo_procedimiento"]
        }
        Update: {
          created_at?: string
          id?: string
          individuo_id?: string | null
          nota?: string | null
          planta_id?: string | null
          predio_id?: string | null
          procedimiento_id?: string
          tipo?: Database["public"]["Enums"]["tipo_objetivo_procedimiento"]
        }
        Relationships: [
          {
            foreignKeyName: "procedimiento_objetivos_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_objetivos_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_objetivos_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_objetivos_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_objetivos_procedimiento_id_fkey"
            columns: ["procedimiento_id"]
            isOneToOne: false
            referencedRelation: "procedimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimiento_reasignaciones: {
        Row: {
          created_at: string
          id: string
          motivo: string | null
          procedimiento_id: string
          reasignado_por_id: string
          responsable_anterior_id: string
          responsable_nuevo_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          motivo?: string | null
          procedimiento_id: string
          reasignado_por_id: string
          responsable_anterior_id: string
          responsable_nuevo_id: string
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: string | null
          procedimiento_id?: string
          reasignado_por_id?: string
          responsable_anterior_id?: string
          responsable_nuevo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedimiento_reasignaciones_procedimiento_id_fkey"
            columns: ["procedimiento_id"]
            isOneToOne: false
            referencedRelation: "procedimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_reasignaciones_reasignado_por_id_fkey"
            columns: ["reasignado_por_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_reasignaciones_responsable_anterior_id_fkey"
            columns: ["responsable_anterior_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimiento_reasignaciones_responsable_nuevo_id_fkey"
            columns: ["responsable_nuevo_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimientos: {
        Row: {
          created_at: string
          created_by: string
          estado: Database["public"]["Enums"]["estado_procedimiento"]
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          idempotency_key: string
          nombre: string
          notas: string | null
          responsable_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          estado?: Database["public"]["Enums"]["estado_procedimiento"]
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          idempotency_key?: string
          nombre: string
          notas?: string | null
          responsable_id: string
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          estado?: Database["public"]["Enums"]["estado_procedimiento"]
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          idempotency_key?: string
          nombre?: string
          notas?: string | null
          responsable_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedimientos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedimientos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolo_ronda: {
        Row: {
          created_at: string
          created_by: string
          descriptores: Json
          id: string
          nombre: string
          numero_ronda: number
          planta_id: string
          tipo_ronda: Database["public"]["Enums"]["tipo_ronda"]
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          descriptores: Json
          id?: string
          nombre: string
          numero_ronda: number
          planta_id: string
          tipo_ronda: Database["public"]["Enums"]["tipo_ronda"]
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          descriptores?: Json
          id?: string
          nombre?: string
          numero_ronda?: number
          planta_id?: string
          tipo_ronda?: Database["public"]["Enums"]["tipo_ronda"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_ronda_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_ronda_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_ronda_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      rango_referencia: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          especie_id: string | null
          fase: Database["public"]["Enums"]["estado_planta"] | null
          id: string
          limite_revision_inferior: number | null
          limite_revision_superior: number | null
          maximo_esperado: number | null
          metrica: string
          minimo_esperado: number | null
          nota: string | null
          updated_at: string
          updated_by: string | null
          vigente_desde: string
          vigente_hasta: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          especie_id?: string | null
          fase?: Database["public"]["Enums"]["estado_planta"] | null
          id?: string
          limite_revision_inferior?: number | null
          limite_revision_superior?: number | null
          maximo_esperado?: number | null
          metrica: string
          minimo_esperado?: number | null
          nota?: string | null
          updated_at?: string
          updated_by?: string | null
          vigente_desde: string
          vigente_hasta?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          especie_id?: string | null
          fase?: Database["public"]["Enums"]["estado_planta"] | null
          id?: string
          limite_revision_inferior?: number | null
          limite_revision_superior?: number | null
          maximo_esperado?: number | null
          metrica?: string
          minimo_esperado?: number | null
          nota?: string | null
          updated_at?: string
          updated_by?: string | null
          vigente_desde?: string
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rango_referencia_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rango_referencia_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rango_referencia_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_snapshot: {
        Row: {
          alcance: Database["public"]["Enums"]["alcance_ranking_snapshot"]
          created_at: string
          created_by: string
          criterios: Json
          especie_id: string
          id: string
          nombre: string
          planta_id: string | null
          poblacion_comparada: number
          scoring_version_id: string
        }
        Insert: {
          alcance: Database["public"]["Enums"]["alcance_ranking_snapshot"]
          created_at?: string
          created_by: string
          criterios: Json
          especie_id: string
          id?: string
          nombre: string
          planta_id?: string | null
          poblacion_comparada: number
          scoring_version_id: string
        }
        Update: {
          alcance?: Database["public"]["Enums"]["alcance_ranking_snapshot"]
          created_at?: string
          created_by?: string
          criterios?: Json
          especie_id?: string
          id?: string
          nombre?: string
          planta_id?: string | null
          poblacion_comparada?: number
          scoring_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_snapshot_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_snapshot_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_snapshot_scoring_version_id_fkey"
            columns: ["scoring_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_version"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_snapshot_resultado: {
        Row: {
          cobertura: Json | null
          codigo_display: string
          detalle: Json
          evaluacion_id: string
          grupo: string[] | null
          individuo_id: string
          posicion: number
          posicion_grupo: number | null
          puntaje: number
          snapshot_id: string
        }
        Insert: {
          cobertura?: Json | null
          codigo_display: string
          detalle: Json
          evaluacion_id: string
          grupo?: string[] | null
          individuo_id: string
          posicion: number
          posicion_grupo?: number | null
          puntaje: number
          snapshot_id: string
        }
        Update: {
          cobertura?: Json | null
          codigo_display?: string
          detalle?: Json
          evaluacion_id?: string
          grupo?: string[] | null
          individuo_id?: string
          posicion?: number
          posicion_grupo?: number | null
          puntaje?: number
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_snapshot_resultado_evaluacion_id_fkey"
            columns: ["evaluacion_id"]
            isOneToOne: false
            referencedRelation: "evaluaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_snapshot_resultado_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_snapshot_resultado_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ranking_snapshot"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivacion_individuo: {
        Row: {
          created_at: string
          created_by: string | null
          estado_anterior: Database["public"]["Enums"]["estado_vital"]
          fecha_baja_anterior: string | null
          id: string
          individuo_id: string
          motivo: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estado_anterior: Database["public"]["Enums"]["estado_vital"]
          fecha_baja_anterior?: string | null
          id?: string
          individuo_id: string
          motivo: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estado_anterior?: Database["public"]["Enums"]["estado_vital"]
          fecha_baja_anterior?: string | null
          id?: string
          individuo_id?: string
          motivo?: string
        }
        Relationships: []
      }
      registros_evento: {
        Row: {
          created_at: string
          created_by: string | null
          datos: Json
          eliminado_at: string | null
          fecha: string
          id: string
          notas: string | null
          planta_id: string
          tipo_evento: Database["public"]["Enums"]["tipo_evento"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datos?: Json
          eliminado_at?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          planta_id: string
          tipo_evento: Database["public"]["Enums"]["tipo_evento"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datos?: Json
          eliminado_at?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          planta_id?: string
          tipo_evento?: Database["public"]["Enums"]["tipo_evento"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registros_evento_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_evento_planta_id_fkey"
            columns: ["planta_id"]
            isOneToOne: false
            referencedRelation: "plantas_operativas"
            referencedColumns: ["id"]
          },
        ]
      }
      ronda_evaluacion_anual: {
        Row: {
          anio: number | null
          created_at: string
          created_by: string | null
          fecha_inicio: string | null
          id: string
          individuo_id: string
          no_evaluada_detalle: string | null
          no_evaluada_en: string | null
          no_evaluada_motivo: string | null
          no_evaluada_por: string | null
          numero_ronda: number
          predio_id: string | null
          scoring_version_id: string | null
          tipo_ronda: Database["public"]["Enums"]["tipo_ronda"]
        }
        Insert: {
          anio?: number | null
          created_at?: string
          created_by?: string | null
          fecha_inicio?: string | null
          id?: string
          individuo_id: string
          no_evaluada_detalle?: string | null
          no_evaluada_en?: string | null
          no_evaluada_motivo?: string | null
          no_evaluada_por?: string | null
          numero_ronda: number
          predio_id?: string | null
          scoring_version_id?: string | null
          tipo_ronda?: Database["public"]["Enums"]["tipo_ronda"]
        }
        Update: {
          anio?: number | null
          created_at?: string
          created_by?: string | null
          fecha_inicio?: string | null
          id?: string
          individuo_id?: string
          no_evaluada_detalle?: string | null
          no_evaluada_en?: string | null
          no_evaluada_motivo?: string | null
          no_evaluada_por?: string | null
          numero_ronda?: number
          predio_id?: string | null
          scoring_version_id?: string | null
          tipo_ronda?: Database["public"]["Enums"]["tipo_ronda"]
        }
        Relationships: [
          {
            foreignKeyName: "ronda_evaluacion_anual_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ronda_evaluacion_anual_individuo_id_fkey"
            columns: ["individuo_id"]
            isOneToOne: false
            referencedRelation: "individuos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ronda_evaluacion_anual_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ronda_evaluacion_anual_scoring_version_id_fkey"
            columns: ["scoring_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_version"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_categoria_peso: {
        Row: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          created_at: string
          id: string
          peso: number
          scoring_version_id: string
        }
        Insert: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          created_at?: string
          id?: string
          peso: number
          scoring_version_id: string
        }
        Update: {
          categoria?: Database["public"]["Enums"]["categoria_scoring"]
          created_at?: string
          id?: string
          peso?: number
          scoring_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_categoria_peso_scoring_version_id_fkey"
            columns: ["scoring_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_version"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_metrica: {
        Row: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          created_at: string
          direccion_favorable: Database["public"]["Enums"]["direccion_scoring"]
          id: string
          maximo_normalizacion: number | null
          metodo_normalizacion: Database["public"]["Enums"]["metodo_normalizacion_scoring"]
          metrica: string
          minimo_normalizacion: number | null
          orden: number
          peso: number
          rango_referencia_id: string | null
          scoring_version_id: string
          tratamiento_nulos: Database["public"]["Enums"]["tratamiento_nulos_scoring"]
        }
        Insert: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          created_at?: string
          direccion_favorable?: Database["public"]["Enums"]["direccion_scoring"]
          id?: string
          maximo_normalizacion?: number | null
          metodo_normalizacion: Database["public"]["Enums"]["metodo_normalizacion_scoring"]
          metrica: string
          minimo_normalizacion?: number | null
          orden: number
          peso: number
          rango_referencia_id?: string | null
          scoring_version_id: string
          tratamiento_nulos?: Database["public"]["Enums"]["tratamiento_nulos_scoring"]
        }
        Update: {
          categoria?: Database["public"]["Enums"]["categoria_scoring"]
          created_at?: string
          direccion_favorable?: Database["public"]["Enums"]["direccion_scoring"]
          id?: string
          maximo_normalizacion?: number | null
          metodo_normalizacion?: Database["public"]["Enums"]["metodo_normalizacion_scoring"]
          metrica?: string
          minimo_normalizacion?: number | null
          orden?: number
          peso?: number
          rango_referencia_id?: string | null
          scoring_version_id?: string
          tratamiento_nulos?: Database["public"]["Enums"]["tratamiento_nulos_scoring"]
        }
        Relationships: [
          {
            foreignKeyName: "scoring_metrica_rango_referencia_id_fkey"
            columns: ["rango_referencia_id"]
            isOneToOne: false
            referencedRelation: "rango_referencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_metrica_scoring_version_id_fkey"
            columns: ["scoring_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_version"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_version: {
        Row: {
          aprobado_at: string | null
          aprobado_by: string | null
          created_at: string
          created_by: string | null
          criterio_desempate: Json
          especie_id: string | null
          estado: Database["public"]["Enums"]["estado_scoring_version"]
          fase: Database["public"]["Enums"]["estado_planta"] | null
          id: string
          nombre: string
          nota: string | null
          umbral_delta_leve: number
          umbral_delta_marcado: number
          updated_at: string
          updated_by: string | null
          vigente_desde: string
          vigente_hasta: string | null
        }
        Insert: {
          aprobado_at?: string | null
          aprobado_by?: string | null
          created_at?: string
          created_by?: string | null
          criterio_desempate?: Json
          especie_id?: string | null
          estado?: Database["public"]["Enums"]["estado_scoring_version"]
          fase?: Database["public"]["Enums"]["estado_planta"] | null
          id?: string
          nombre: string
          nota?: string | null
          umbral_delta_leve?: number
          umbral_delta_marcado?: number
          updated_at?: string
          updated_by?: string | null
          vigente_desde: string
          vigente_hasta?: string | null
        }
        Update: {
          aprobado_at?: string | null
          aprobado_by?: string | null
          created_at?: string
          created_by?: string | null
          criterio_desempate?: Json
          especie_id?: string | null
          estado?: Database["public"]["Enums"]["estado_scoring_version"]
          fase?: Database["public"]["Enums"]["estado_planta"] | null
          id?: string
          nombre?: string
          nota?: string | null
          umbral_delta_leve?: number
          umbral_delta_marcado?: number
          updated_at?: string
          updated_by?: string | null
          vigente_desde?: string
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_version_aprobado_by_fkey"
            columns: ["aprobado_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_version_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_version_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_version_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sector: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          id: string
          nombre: string
          predio_id: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nombre: string
          predio_id: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nombre?: string
          predio_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sector_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_predio_id_fkey"
            columns: ["predio_id"]
            isOneToOne: false
            referencedRelation: "predio"
            referencedColumns: ["id"]
          },
        ]
      }
      sitio: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sitio_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sustrato: {
        Row: {
          activo: boolean
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      variedades: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          especie_id: string
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          especie_id: string
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          especie_id?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "variedades_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variedades_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      plantas_operativas: {
        Row: {
          codigo_sistema: string | null
          created_at: string | null
          es_prueba: boolean | null
          especie_id: string | null
          especie_nombre: string | null
          estado: Database["public"]["Enums"]["estado_planta"] | null
          fecha_cambio_estado: string | null
          genetica_a: string | null
          genetica_b: string | null
          id: string | null
          numero_notion_legacy: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plantas_especie_id_fkey"
            columns: ["especie_id"]
            isOneToOne: false
            referencedRelation: "especies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activar_version_scoring: {
        Args: { p_version_id: string }
        Returns: string
      }
      actualizar_linaje: {
        Args: {
          p_cruzamiento: string
          p_mama_id: string
          p_papa_id: string
          p_planta_id: string
        }
        Returns: Json
      }
      actualizar_participantes_canal_libre: {
        Args: { p_canal_id: string; p_participantes: string[] }
        Returns: undefined
      }
      actualizar_procedimiento: {
        Args: {
          p_estado: Database["public"]["Enums"]["estado_procedimiento"]
          p_fecha_fin?: string
          p_fecha_inicio: string
          p_insumos?: Json
          p_nombre: string
          p_notas?: string
          p_objetivos?: Json
          p_procedimiento_id: string
          p_tipo: string
        }
        Returns: undefined
      }
      anio_temporada: {
        Args: { p_especie_id: string; p_numero_ronda: number }
        Returns: number
      }
      aplicar_baja_individuos: {
        Args: {
          p_criterios: Database["public"]["Enums"]["criterio_baja"][]
          p_estado: Database["public"]["Enums"]["estado_vital"]
          p_fecha: string
          p_idempotency_key: string
          p_ids: string[]
          p_nota: string
        }
        Returns: undefined
      }
      archivar_canal_libre: { Args: { p_canal_id: string }; Returns: undefined }
      borrar_cruzamiento: {
        Args: { p_planta_id: string; p_tipo: string }
        Returns: Json
      }
      caducar_importaciones_cruces: { Args: never; Returns: number }
      calcular_categorias_evaluacion: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
          p_scoring_version_id: string
        }
        Returns: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          subpuntaje: number
        }[]
      }
      calcular_metricas_evaluacion: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
          p_scoring_version_id: string
        }
        Returns: {
          categoria: Database["public"]["Enums"]["categoria_scoring"]
          metrica: string
          normalizado: number
          peso: number
          valor: number
        }[]
      }
      calcular_ranking_base: {
        Args: {
          p_especie_id?: string
          p_planta_id?: string
          p_por_ronda?: boolean
          p_scoring_version_id: string
        }
        Returns: {
          cobertura: Json
          codigo_display: string
          codigo_sistema: string
          configuradas: number
          detalle_categorias: Json
          detalle_metricas: Json
          disponibles: number
          es_prueba: boolean
          especie_id: string
          estado_evaluacion: Database["public"]["Enums"]["estado_evaluacion"]
          evaluacion_id: string
          evaluacion_updated_at: string
          fecha_evaluacion: string
          grupo: string[]
          individuo_id: string
          no_comparable: boolean
          numero_ronda: number
          planta_id: string
          puntaje_bruto: number
          requiere_revision: boolean
          scoring_version_id: string
          scoring_version_nombre: string
          tiene_metrica_marcada: boolean
        }[]
      }
      calcular_ranking_grupos: {
        Args: {
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_minimo?: number
          p_numero_ronda?: number
          p_planta_id?: string
          p_por_ronda?: boolean
          p_scoring_version_id: string
        }
        Returns: {
          cobertura: Json
          codigo_display: string
          codigo_sistema: string
          detalle_categorias: Json
          detalle_metricas: Json
          es_prueba: boolean
          especie_id: string
          estado_evaluacion: Database["public"]["Enums"]["estado_evaluacion"]
          estado_ranking: string
          evaluacion_id: string
          fecha_evaluacion: string
          grupo: string[]
          individuo_id: string
          no_comparable: boolean
          numero_ronda: number
          planta_id: string
          posicion_grupo: number
          puntaje: number
          requiere_revision: boolean
          scoring_version_id: string
          scoring_version_nombre: string
          tamano_grupo: number
          tiene_metrica_marcada: boolean
        }[]
      }
      calcular_ranking_nucleo: {
        Args: {
          p_con_grupo?: boolean
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_numero_ronda?: number
          p_planta_id?: string
          p_por_ronda?: boolean
          p_scoring_version_id: string
        }
        Returns: {
          cobertura: Json
          codigo_display: string
          codigo_sistema: string
          configuradas: number
          detalle_categorias: Json
          detalle_metricas: Json
          disponibles: number
          es_prueba: boolean
          especie_id: string
          estado_evaluacion: Database["public"]["Enums"]["estado_evaluacion"]
          evaluacion_id: string
          evaluacion_updated_at: string
          fecha_evaluacion: string
          grupo: string[]
          individuo_id: string
          no_comparable: boolean
          numero_ronda: number
          planta_id: string
          puntaje_bruto: number
          requiere_revision: boolean
          scoring_version_id: string
          scoring_version_nombre: string
          tiene_metrica_marcada: boolean
        }[]
      }
      calcular_ranking_operativo: {
        Args: {
          p_especie_id?: string
          p_planta_id?: string
          p_por_ronda?: boolean
          p_scoring_version_id: string
        }
        Returns: {
          codigo_display: string
          codigo_sistema: string
          detalle_categorias: Json
          detalle_metricas: Json
          elegible: boolean
          especie_id: string
          estado_evaluacion: Database["public"]["Enums"]["estado_evaluacion"]
          evaluacion_id: string
          evaluacion_updated_at: string
          fecha_evaluacion: string
          individuo_id: string
          motivo_exclusion: string
          no_comparable: boolean
          numero_ronda: number
          planta_id: string
          puntaje_ponderado: number
          requiere_revision: boolean
          scoring_version_id: string
          scoring_version_nombre: string
        }[]
      }
      captura_tiene_respaldo: {
        Args: {
          p_etapa: Database["public"]["Enums"]["estado_planta"]
          p_planta: string
        }
        Returns: boolean
      }
      cerrar_temporada_ranking: {
        Args: { p_especie_id: string; p_nombre?: string; p_numero_ronda: number }
        Returns: Json
      }
      clave_nombre_variedad: { Args: { p_nombre: string }; Returns: string }
      codigo_display_numero: {
        Args: { p_codigo_display: string }
        Returns: number
      }
      comparar_snapshot_vivo: { Args: { p_snapshot_id: string }; Returns: Json }
      confirmar_importacion_cruces: {
        Args: {
          p_crear_variedades: boolean
          p_idempotency_key: string
          p_lote_id: string
        }
        Returns: Json
      }
      congelar_ranking: {
        Args: { p_especie_id?: string; p_nombre: string; p_planta_id?: string }
        Returns: string
      }
      congelar_ranking_grupos: {
        Args: { p_especie_id?: string; p_nombre: string; p_planta_id?: string }
        Returns: string
      }
      consultar_mapa_viewport: {
        Args: {
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_latitud_maxima: number
          p_latitud_minima: number
          p_limite?: number
          p_longitud_maxima: number
          p_longitud_minima: number
          p_offset?: number
        }
        Returns: Json
      }
      contar_valores_descriptor: {
        Args: { p_clave: string; p_especie_id: string }
        Returns: number
      }
      conteo_cruces_por_estado: { Args: never; Returns: Json }
      crear_canal_libre: {
        Args: { p_nombre: string; p_participantes?: string[] }
        Returns: string
      }
      crear_procedimiento: {
        Args: {
          p_fecha_fin?: string
          p_fecha_inicio: string
          p_idempotency_key?: string
          p_insumos?: Json
          p_nombre: string
          p_notas?: string
          p_objetivos?: Json
          p_responsable_id?: string
          p_tipo: string
        }
        Returns: string
      }
      dar_baja_individuos: {
        Args: {
          p_criterios: Database["public"]["Enums"]["criterio_baja"][]
          p_estado: Database["public"]["Enums"]["estado_vital"]
          p_fecha: string
          p_idempotency_key: string
          p_ids: string[]
          p_nota: string
        }
        Returns: Json
      }
      definir_protocolo_ronda: {
        Args: {
          p_descriptores: Json
          p_nombre: string
          p_numero_ronda: number
          p_planta_id: string
          p_tipo_ronda: Database["public"]["Enums"]["tipo_ronda"]
        }
        Returns: string
      }
      descartar_importacion_cruces: {
        Args: { p_lote_id: string }
        Returns: undefined
      }
      descriptor_activo_en_especie: {
        Args: { p_clave: string; p_especie_id: string; p_fase: string }
        Returns: boolean
      }
      descriptores_fuera_de_revision: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
        }
        Returns: string[]
      }
      enviar_mensaje_chat: {
        Args: {
          p_canal_id: string
          p_clave_envio: string
          p_contenido: string
          p_mencionados?: string[]
          p_mencionar_todos?: boolean
        }
        Returns: {
          autor_id: string | null
          autor_nombre: string
          canal_id: string
          clave_envio: string
          contenido: string
          creado_at: string
          id: string
          posicion: number
        }
        SetofOptions: {
          from: "*"
          to: "chat_mensajes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      es_admin: { Args: never; Returns: boolean }
      es_participante_chat: {
        Args: { p_canal_id: string; p_usuario_id: string }
        Returns: boolean
      }
      estado_operativo_cruce: {
        Args: { p_planta_id: string }
        Returns: {
          evaluaciones_cerradas: number
          individuos_vivos: number
          ronda_anio: number
          ronda_numero: number
          ronda_tipo: Database["public"]["Enums"]["tipo_ronda"]
          sin_evaluacion_cerrada: number
          ultima_actividad: string
          ultima_actividad_por: string
        }[]
      }
      estados_descriptores: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
        }
        Returns: Json
      }
      etiqueta_temporada: {
        Args: { p_fecha: string }
        Returns: string
      }
      etiquetar_delta: {
        Args: {
          p_delta: number
          p_umbral_leve: number
          p_umbral_marcado: number
        }
        Returns: string
      }
      evaluacion_exige_muestra: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
        }
        Returns: boolean
      }
      evaluacion_tiene_descriptores_completos: {
        Args: { p: Database["public"]["Tables"]["evaluaciones"]["Row"] }
        Returns: boolean
      }
      evaluar_baja_individuos: {
        Args: { p_ids: string[] }
        Returns: {
          codigo_display: string
          created_by: string
          individuo_id: string
          motivo_exclusion: string
          planta_id: string
        }[]
      }
      evecl_comparar: {
        Args: {
          p_conjunto?: string
          p_ensayo_id?: number
          p_modo: string
          p_variedad?: string
        }
        Returns: Json
      }
      evecl_eliminar_ficha: { Args: { p_ficha_id: number }; Returns: undefined }
      evecl_guardar_ensayo: {
        Args: {
          p_area_evaluada?: string
          p_codigo_parcela?: string
          p_direccion?: string
          p_empresa?: string
          p_encargado_predio?: string
          p_id?: number
          p_latitud?: number
          p_localidad?: string
          p_longitud?: number
          p_nombre_productor?: string
          p_notas?: string
        }
        Returns: number
      }
      evecl_guardar_ficha: {
        Args: {
          p_codigo_genotipo?: string
          p_codigo_planta?: string
          p_encargado?: string
          p_ensayo_id?: number
          p_fecha_evaluacion?: string
          p_fecha_siembra?: string
          p_id?: number
          p_idempotency_key?: string
          p_notas?: string
          p_numero_repeticion?: number
          p_origen_cruza?: string
          p_respuestas?: Json
          p_tipo?: Database["public"]["Enums"]["evecl_tipo_ficha"]
          p_variedad?: string
        }
        Returns: number
      }
      evecl_guardar_ficha_con_bajas: {
        Args: { p_descriptores_eliminar?: number[]; p_entrada: Json }
        Returns: number
      }
      evecl_obtener_catalogo: { Args: never; Returns: Json }
      evecl_obtener_ensayos: {
        Args: never
        Returns: {
          area_evaluada: string
          codigo_parcela: string
          created_at: string
          created_by: string
          direccion: string
          empresa: string
          encargado_predio: string
          id: number
          latitud: number
          localidad: string
          longitud: number
          nombre_productor: string
          notas: string
          total_fichas: number
          total_variedades: number
        }[]
      }
      evecl_obtener_ficha: { Args: { p_ficha_id: number }; Returns: Json }
      evecl_obtener_fichas: {
        Args: { p_ensayo_id?: number; p_variedad?: string }
        Returns: {
          codigo_planta: string
          ensayo_id: number
          fecha_evaluacion: string
          id: number
          numero_repeticion: number
          respondidos: number
          tipo: Database["public"]["Enums"]["evecl_tipo_ficha"]
          total_descriptores: number
          variedad: string
        }[]
      }
      extraer_metrica_evaluacion: {
        Args: {
          p_evaluacion: Database["public"]["Tables"]["evaluaciones"]["Row"]
          p_metrica: string
        }
        Returns: number
      }
      guardar_cosecha: {
        Args: {
          p_cambios: Json
          p_fecha_historial: string
          p_planta_id: string
          p_registrar_archivo?: boolean
        }
        Returns: string
      }
      guardar_siembra: {
        Args: {
          p_cambios: Json
          p_fecha: string
          p_insumo_ids: string[]
          p_nota: string
          p_planta_id: string
          p_sustratos: Json
        }
        Returns: string
      }
      individualizar_plantas: {
        Args: { p_cantidad: number; p_planta_id: string }
        Returns: Json
      }
      individualizar_plantas_una_vez: {
        Args: { p_cantidad: number; p_clave: string; p_planta_id: string }
        Returns: Json
      }
      individuo_esta_vivo: {
        Args: { p_individuo_id: string }
        Returns: boolean
      }
      iniciar_ronda_esperada: {
        Args: {
          p_individuo_id: string
          p_numero_esperado: number
          p_tipo: string
        }
        Returns: Json
      }
      iniciar_ronda_evaluacion: {
        Args: { p_individuo_id: string }
        Returns: Json
      }
      iniciar_ronda_multisitio: {
        Args: { p_individuo_id: string; p_predio_id?: string }
        Returns: Json
      }
      limite_baja_en_lote: { Args: never; Returns: number }
      limpiar_canal_chat: { Args: { p_canal_id: string }; Returns: number }
      listar_canales_chat: {
        Args: never
        Returns: {
          archivado: boolean
          creado_at: string
          creado_por: string
          entidad_id: string
          entidad_nombre: string
          id: string
          no_leidos: number
          oculto_desde: number
          puede_gestionar: boolean
          tipo: string
          ultima_actividad_at: string
          ultima_lectura: number
          ultima_posicion: number
        }[]
      }
      listar_cruces_analiticos: {
        Args: {
          p_busqueda?: string
          p_especie_id?: string
          p_estado?: Database["public"]["Enums"]["estado_planta"]
          p_incluir_pruebas?: boolean
          p_limite?: number
          p_offset?: number
          p_orden?: string
          p_solo_pendientes?: boolean
        }
        Returns: Json
      }
      listar_individuos_procedimiento_predio: {
        Args: { p_predio_id: string; p_procedimiento_id: string }
        Returns: {
          codigo_display: string
          individuo_id: string
          sector_id: string
          sector_nombre: string
        }[]
      }
      listar_notificaciones_chat: {
        Args: never
        Returns: {
          autor_nombre: string
          canal_id: string
          canal_nombre: string
          canal_tipo: string
          contenido: string
          creado_at: string
          leida_at: string
          mensaje_id: string
          tipo: string
        }[]
      }
      listar_participantes_chat: {
        Args: { p_canal_id: string }
        Returns: {
          id: string
          nombre: string
        }[]
      }
      listar_predios_activos_cruzamiento: {
        Args: { p_planta_id: string }
        Returns: {
          individuos_activos: number
          predio_id: string
          predio_nombre: string
        }[]
      }
      listar_snapshots_ranking: {
        Args: {
          p_especie_id?: string
          p_limite?: number
          p_offset?: number
          p_planta_id?: string
        }
        Returns: Json
      }
      marcar_baja_individuo: {
        Args: {
          p_criterios: Database["public"]["Enums"]["criterio_baja"][]
          p_estado: Database["public"]["Enums"]["estado_vital"]
          p_fecha: string
          p_idempotency_key: string
          p_individuo_id: string
          p_nota: string
        }
        Returns: Json
      }
      marcar_chat_leido: {
        Args: { p_canal_id: string; p_posicion: number }
        Returns: undefined
      }
      marcar_notificacion_chat_leida: {
        Args: { p_mensaje_id: string }
        Returns: undefined
      }
      marcar_ronda_no_evaluada: {
        Args: { p_detalle?: string; p_motivo: string; p_ronda_id: string }
        Returns: undefined
      }
      marcar_todas_notificaciones_chat_leidas: {
        Args: never
        Returns: undefined
      }
      nombres_de_usuarios: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          nombre: string
        }[]
      }
      normalizar_metrica_scoring: {
        Args: {
          p_direccion: Database["public"]["Enums"]["direccion_scoring"]
          p_maximo: number
          p_minimo: number
          p_valor: number
        }
        Returns: number
      }
      nueva_version_scoring: {
        Args: {
          p_nombre: string
          p_nota?: string
          p_version_base_id: string
          p_vigente_desde: string
        }
        Returns: string
      }
      obtener_canal_chat: {
        Args: { p_entidad_id?: string; p_tipo?: string }
        Returns: string
      }
      obtener_clima_predio: {
        Args: { p_planta_id?: string; p_predio_id?: string }
        Returns: Json
      }
      obtener_comparacion_rondas: {
        Args: { p_individuo_id?: string; p_planta_id?: string }
        Returns: Json
      }
      obtener_correcciones_individuo: {
        Args: { p_individuo_id: string }
        Returns: Json
      }
      obtener_dashboard_cientifico: {
        Args: {
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_limite?: number
        }
        Returns: Json
      }
      obtener_detalle_snapshot: {
        Args: { p_snapshot_id: string }
        Returns: Json
      }
      obtener_estados_evaluacion: {
        Args: { p_evaluacion_id: string }
        Returns: Json
      }
      obtener_mapa_cruce: { Args: { p_planta_id: string }; Returns: Json }
      obtener_planilla_ronda: {
        Args: {
          p_numero_ronda?: number
          p_planta_id: string
          p_tipo_ronda?: Database["public"]["Enums"]["tipo_ronda"]
        }
        Returns: Json
      }
      obtener_planta: { Args: { p_planta_id: string }; Returns: Json }
      obtener_procedencia_calidad_ronda: {
        Args: { p_ronda_id: string }
        Returns: {
          descriptores_con_revision: string[]
          descriptores_no_comparables: string[]
        }[]
      }
      obtener_ranking_global_filtrado: {
        Args: {
          p_especie_id: string
          p_estado_vital?: Database["public"]["Enums"]["estado_vital"]
          p_fecha_desde?: string
          p_fecha_hasta?: string
          p_limite?: number
          p_offset?: number
          p_orden?: string
          p_planta_id?: string
        }
        Returns: Json
      }
      obtener_ranking_operativo: {
        Args: {
          p_especie_id?: string
          p_limite?: number
          p_offset?: number
          p_orden?: string
          p_planta_id?: string
        }
        Returns: Json
      }
      obtener_ranking_polinizacion_varietal: {
        Args: { p_especie_id: string; p_rol?: string }
        Returns: {
          cruces_distintos: number
          flores_reales: number
          flores_totales: number
          sesiones_polinizacion: number
          tipo_fila: string
          variedad_id: string
          variedad_nombre: string
        }[]
      }
      obtener_ranking_por_grupos: {
        Args: {
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_numero_ronda?: number
          p_planta_id?: string
        }
        Returns: Json
      }
      obtener_referencias_evaluacion: {
        Args: { p_fecha?: string; p_ronda_id: string }
        Returns: Json
      }
      obtener_resumen_individuos: {
        Args: { p_planta_id: string }
        Returns: Json
      }
      obtener_resumen_mapa_territorial: {
        Args: {
          p_especie_id?: string
          p_incluir_pruebas?: boolean
          p_limite?: number
          p_offset?: number
          p_predio_id?: string
          p_sector_id?: string
        }
        Returns: Json
      }
      obtener_scoring_planta: {
        Args: { p_planta_id: string }
        Returns: {
          codigo_display: string
          codigo_sistema: string
          detalle_metricas: Json
          elegible: boolean
          especie_id: string
          estado_evaluacion: Database["public"]["Enums"]["estado_evaluacion"]
          evaluacion_id: string
          evaluacion_updated_at: string
          fecha_evaluacion: string
          individuo_id: string
          motivo_exclusion: string
          no_comparable: boolean
          numero_ronda: number
          planta_id: string
          posicion: number
          puntaje_ponderado: number
          requiere_revision: boolean
          scoring_version_id: string
          scoring_version_nombre: string
        }[]
      }
      obtener_series_historicas_cientificas: {
        Args: {
          p_especie_id: string
          p_fecha_desde?: string
          p_fecha_hasta?: string
          p_planta_id?: string
        }
        Returns: Json
      }
      panorama_especies: {
        Args: { p_especie_id?: string; p_incluir_pruebas?: boolean }
        Returns: Json
      }
      poscosecha_incompleta_cruce: {
        Args: { p_planta_id: string }
        Returns: number
      }
      previsualizar_baja_individuos: {
        Args: { p_ids: string[] }
        Returns: Json
      }
      previsualizar_importacion_cruces: {
        Args: { p_archivo_nombre: string; p_filas: Json }
        Returns: Json
      }
      procedimiento_planta_auditable: {
        Args: { p_procedimiento_id: string }
        Returns: string
      }
      procesar_respuesta_clima_predio: {
        Args: { p_body: Json; p_predio_id: string }
        Returns: undefined
      }
      puede_acceder_chat: { Args: { p_canal_id: string }; Returns: boolean }
      puede_acceder_entidad_chat: {
        Args: { p_entidad_id: string; p_solo_activa?: boolean; p_tipo: string }
        Returns: boolean
      }
      puede_gestionar_canal_libre: {
        Args: { p_canal_id: string }
        Returns: boolean
      }
      puede_ver_linaje_actual: { Args: never; Returns: boolean }
      quitar_ronda_no_evaluada: {
        Args: { p_ronda_id: string }
        Returns: undefined
      }
      reactivar_individuo: {
        Args: { p_individuo_id: string; p_motivo: string }
        Returns: undefined
      }
      reasignar_procedimiento: {
        Args: {
          p_motivo?: string
          p_procedimiento_id: string
          p_responsable_nuevo_id: string
        }
        Returns: undefined
      }
      recolectar_clima_pendiente: { Args: never; Returns: undefined }
      redactar_texto_linaje: { Args: { p_dato: Json }; Returns: Json }
      reemplazar_insumos_procedimiento: {
        Args: { p_insumos: Json; p_procedimiento_id: string }
        Returns: undefined
      }
      reemplazar_objetivos_procedimiento: {
        Args: { p_objetivos: Json; p_procedimiento_id: string }
        Returns: undefined
      }
      refrescar_clima_predios: { Args: never; Returns: undefined }
      registrar_traslado_individuo: {
        Args: {
          p_fecha_inicio: string
          p_individuo_id: string
          p_latitud?: number
          p_longitud?: number
          p_precision_metros?: number
          p_referencia_operativa?: string
          p_sector_id: string
          p_ubicacion_exacta?: string
        }
        Returns: string
      }
      reiniciar_cruzamiento: { Args: { p_planta_id: string }; Returns: Json }
      resolver_scoring_version: {
        Args: {
          p_especie_id: string
          p_fase?: Database["public"]["Enums"]["estado_planta"]
          p_fecha?: string
        }
        Returns: string
      }
      restaurar_cruzamiento: { Args: { p_planta_id: string }; Returns: Json }
      resumen_individuos_cruce: {
        Args: { p_planta_id: string }
        Returns: {
          codigo_display: string
          estado_vital: Database["public"]["Enums"]["estado_vital"]
          evaluaciones_count: number
          individuo_id: string
          observaciones: Json
          pcr_count: number
          predio_nombre: string
          sector_nombre: string
          tiene_emplazamiento: boolean
        }[]
      }
      retroceder_fase_cruce: {
        Args: { p_estado_actual: Database["public"]["Enums"]["estado_planta"]; p_motivo: string; p_planta_id: string }
        Returns: Database["public"]["Enums"]["estado_planta"]
      }
      revertir_importacion: { Args: { p_lote_id: string }; Returns: Json }
      ronda_contiene_metrica_marcada: {
        Args: { p_ronda_id: string; p_scoring_version_id: string }
        Returns: boolean
      }
      ronda_individuo_esta_vivo: {
        Args: { p_ronda_id: string }
        Returns: boolean
      }
      scoring_version_en_uso: {
        Args: { p_version_id: string }
        Returns: boolean
      }
      sincronizar_clima_predio: {
        Args: { p_meses_atras?: number; p_predio_id: string }
        Returns: number
      }
      sitio_predeterminado_legacy: { Args: never; Returns: string }
      temporada_sugerida: {
        Args: { p_especie_id: string; p_numero_ronda: number }
        Returns: string
      }
      temporadas_especie: {
        Args: { p_especie_id: string }
        Returns: { etiqueta: string; numero_ronda: number; planta_id: string; tipo_ronda: Database["public"]["Enums"]["tipo_ronda"] }[]
      }
      ultima_accion_auditada_cruce: {
        Args: { p_planta_id: string }
        Returns: {
          ocurrido_en: string
          usuario_id: string
        }[]
      }
      unificar_evaluacion_ronda: {
        Args: { p_ronda_id: string }
        Returns: {
          altura_brote_mm: number | null
          anio: number
          bloom: number | null
          brix: number | null
          cicatriz: number | null
          brotacion: number | null
          caida_fruto: number | null
          calibre_mm: number | null
          cantidad_frutos: number | null
          capturada_at: string
          color: number | null
          color_follaje: number | null
          concentracion_cosecha: number | null
          created_at: string
          created_by: string | null
          cuaja: number | null
          dano_calor: number | null
          diametro_brote_mm: number | null
          distribucion_flores_frutos: number | null
          estado: Database["public"]["Enums"]["estado_evaluacion"]
          evaluador: string | null
          fecha: string
          fecha_inicio_floracion: string | null
          firmeza: number | null
          floracion: number | null
          golpe_sol: number | null
          id: string
          idempotency_key: string
          motivo_cambio: string | null
          n_flores_varas_basales: number | null
          n_frutos_varas_basales: number | null
          n_varas_basales: number | null
          n_varas_con_flor: number | null
          no_comparable: boolean
          observaciones: string | null
          pct_buen_estado_15d: number | null
          pct_buen_estado_30d: number | null
          pct_buen_estado_45d: number | null
          pct_flores: number | null
          pct_fruta_exportable: number | null
          pct_frutos: number | null
          peso_promedio_g: number | null
          peso_total_g: number | null
          precocidad: number | null
          predio_id: string | null
          presencia_yemas_florales: number | null
          protocolo_id: string | null
          rend_kg_planta: number | null
          rend_t_ha: number | null
          requiere_revision: boolean
          ronda_id: string
          sin_muestra: boolean
          updated_at: string
          vigor_vegetativo: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "evaluaciones"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      validar_descriptores_protocolo: {
        Args: { p_descriptores: Json }
        Returns: string
      }
      validar_filas_importacion_cruces: {
        Args: { p_filas: Json }
        Returns: {
          codigo_sistema: string
          cruzamiento: string
          errores: string[]
          es_prueba: boolean
          especie_id: string
          mama: string
          mama_id: string
          n: number
          papa: string
          papa_id: string
          sugerencias: Json
          variedades_faltantes: string[]
        }[]
      }
      validar_parametros_baja: {
        Args: {
          p_criterios: Database["public"]["Enums"]["criterio_baja"][]
          p_estado: Database["public"]["Enums"]["estado_vital"]
          p_fecha: string
        }
        Returns: undefined
      }
    }
    Enums: {
      alcance_ranking_snapshot: "cruzamiento" | "especie"
      categoria_scoring:
        | "fenologia"
        | "fruto_calidad"
        | "produccion"
        | "brotes"
        | "estres"
      criterio_baja:
        | "vigor"
        | "arquitectura"
        | "sanidad"
        | "uniformidad"
        | "muerte_natural"
      direccion_scoring: "mayor" | "menor"
      escarificacion_subtipo: "quimica" | "fisica" | "estratificacion"
      estado_evaluacion: "borrador" | "completa" | "corregida" | "anulada"
      estado_planta:
        | "sin_empezar"
        | "polinizacion"
        | "cosecha"
        | "siembra_semilla"
        | "germinacion"
        | "trasplante"
        | "crecimiento"
        | "evaluacion_anual"
        | "traslado_destino"
        | "proceso_finalizado"
      estado_procedimiento:
        | "planificado"
        | "en_curso"
        | "completado"
        | "cancelado"
      estado_scoring_version: "borrador" | "activa" | "inactiva"
      estado_vital: "vivo" | "descartado" | "muerto"
      evecl_eje: "fenologia" | "adaptabilidad" | "calidad" | "productividad"
      evecl_tipo_descriptor: "estado" | "valor"
      evecl_tipo_ficha: "evaluacion" | "testigo"
      fase_evaluacion_reducida: "trasplante" | "crecimiento"
      metodo_normalizacion_scoring: "escala" | "rango_referencia"
      region_chile:
        | "Arica y Parinacota"
        | "Tarapacá"
        | "Antofagasta"
        | "Atacama"
        | "Coquimbo"
        | "Valparaíso"
        | "Metropolitana de Santiago"
        | "Libertador General Bernardo O'Higgins"
        | "Maule"
        | "Ñuble"
        | "Biobío"
        | "La Araucanía"
        | "Los Ríos"
        | "Los Lagos"
        | "Aysén del General Carlos Ibáñez del Campo"
        | "Magallanes y de la Antártica Chilena"
      rol_usuario: "admin" | "operario"
      tipo_archivo: "foto" | "video"
      tipo_evento:
        | "polinizacion"
        | "cosecha"
        | "siembra_semilla"
        | "germinacion"
        | "trasplante"
        | "traslado"
        | "otro"
      tipo_insumo: "fungicida" | "insecticida" | "escarificante" | "otro"
      tipo_objetivo_procedimiento: "cruzamiento" | "predio" | "individuo"
      tipo_procedimiento_cultivo: "poda" | "fertilizacion" | "aplicacion"
      tipo_ronda: "anual" | "multisitio"
      tratamiento_nulos_scoring: "excluir_evaluacion"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          lifecycle_configuration: Json | null
          lifecycle_configuration_generation: string | null
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: { delete_markers?: string; noncurrent_versions?: string }
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
          raw_prefix_param?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delete_markers?: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          next_token_archived_at?: string
          next_token_version?: string
          noncurrent_versions?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          delete_markers?: string
          noncurrent_versions?: string
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
          p_start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
          start_after_archived_at?: string
          start_after_is_continuation?: boolean
          start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alcance_ranking_snapshot: ["cruzamiento", "especie"],
      categoria_scoring: [
        "fenologia",
        "fruto_calidad",
        "produccion",
        "brotes",
        "estres",
      ],
      criterio_baja: [
        "vigor",
        "arquitectura",
        "sanidad",
        "uniformidad",
        "muerte_natural",
      ],
      direccion_scoring: ["mayor", "menor"],
      escarificacion_subtipo: ["quimica", "fisica", "estratificacion"],
      estado_evaluacion: ["borrador", "completa", "corregida", "anulada"],
      estado_planta: [
        "sin_empezar",
        "polinizacion",
        "cosecha",
        "siembra_semilla",
        "germinacion",
        "trasplante",
        "crecimiento",
        "evaluacion_anual",
        "traslado_destino",
        "proceso_finalizado",
      ],
      estado_procedimiento: [
        "planificado",
        "en_curso",
        "completado",
        "cancelado",
      ],
      estado_scoring_version: ["borrador", "activa", "inactiva"],
      estado_vital: ["vivo", "descartado", "muerto"],
      evecl_eje: ["fenologia", "adaptabilidad", "calidad", "productividad"],
      evecl_tipo_descriptor: ["estado", "valor"],
      evecl_tipo_ficha: ["evaluacion", "testigo"],
      fase_evaluacion_reducida: ["trasplante", "crecimiento"],
      metodo_normalizacion_scoring: ["escala", "rango_referencia"],
      region_chile: [
        "Arica y Parinacota",
        "Tarapacá",
        "Antofagasta",
        "Atacama",
        "Coquimbo",
        "Valparaíso",
        "Metropolitana de Santiago",
        "Libertador General Bernardo O'Higgins",
        "Maule",
        "Ñuble",
        "Biobío",
        "La Araucanía",
        "Los Ríos",
        "Los Lagos",
        "Aysén del General Carlos Ibáñez del Campo",
        "Magallanes y de la Antártica Chilena",
      ],
      rol_usuario: ["admin", "operario"],
      tipo_archivo: ["foto", "video"],
      tipo_evento: [
        "polinizacion",
        "cosecha",
        "siembra_semilla",
        "germinacion",
        "trasplante",
        "traslado",
        "otro",
      ],
      tipo_insumo: ["fungicida", "insecticida", "escarificante", "otro"],
      tipo_objetivo_procedimiento: ["cruzamiento", "predio", "individuo"],
      tipo_procedimiento_cultivo: ["poda", "fertilizacion", "aplicacion"],
      tipo_ronda: ["anual", "multisitio"],
      tratamiento_nulos_scoring: ["excluir_evaluacion"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

