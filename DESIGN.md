---
name: BDSecurity
description: Trazabilidad genética de frutales. Herramienta de campo y de escritorio para evaluar y seleccionar genotipos.
colors:
  acento: "#4338ca"
  acento-hover: "#3730a3"
  acento-lavado: "#eef2ff"
  acento-suave: "#e0e7ff"
  acento-claro: "#a5b4fc"
  fondo: "#f6f7fb"
  superficie: "#ffffff"
  superficie-2: "#f9fafb"
  borde: "#e5e7eb"
  borde-fila: "#f0f1f4"
  pista: "#eef0f4"
  tinta: "#111827"
  tinta-2: "#374151"
  tinta-3: "#4b5563"
  tinta-4: "#6b7280"
  ok: "#047857"
  ok-lavado: "#d1fae5"
  falta: "#92400e"
  falta-lavado: "#fef3c7"
  falta-tenue: "#fffbeb"
  revisar: "#991b1b"
  revisar-lavado: "#fee2e2"
  neutro-lavado: "#f3f4f6"
typography:
  titulo-pagina:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  titulo-seccion:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  cuerpo:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  secundario:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  etiqueta:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  cifra:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    fontFeature: "tnum"
  codigo:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 600
rounded:
  control: "8px"
  movil: "10px"
  tarjeta: "12px"
  pildora: "99px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  tap: "44px"
  tap-campo: "52px"
components:
  boton-primario:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  boton-primario-hover:
    backgroundColor: "{colors.acento-hover}"
  boton-secundario:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.control}"
    height: "44px"
  pildora-activa:
    backgroundColor: "{colors.acento-lavado}"
    textColor: "{colors.acento-hover}"
    rounded: "{rounded.pildora}"
    height: "44px"
  tarjeta:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.tarjeta}"
    padding: "16px 20px"
  campo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.control}"
    height: "44px"
---

<!-- Escrito a partir de las pantallas construidas en .scratch/diseno-v2/ (22-10-2026). Reemplaza la identidad «North Star v4» (Work Sans, Geist Mono, #4B3FA6) por decisión de Kadel. Adoptado el 22-10-2026 como identidad de la Fase 2; el logo se mantiene. -->

# Design System: BDSecurity

## Overview

**Creative North Star: «La planilla clara»**

Es una herramienta de trabajo que se lee como una buena planilla. Usa un fondo gris muy claro, tarjetas blancas con un borde fino y mucho aire entre bloques. La jerarquía se marca con tamaño y tono de gris, no con negro ni negritas. Hay un solo acento índigo para la acción principal, la selección y el avance. El ámbar se reserva para lo que falta. La monoespaciada aparece solo en códigos de individuo y de cruce. La densidad es media en escritorio y generosa en celular, donde los objetivos táctiles miden 52 px.

**Key Characteristics:**
- Tarjetas blancas sobre `fondo`, sin sombras.
- Un acento: índigo. El ámbar significa «dato faltante o dudoso» y el rojo significa «revisar».
- Inter con cifras tabulares para los números; JetBrains Mono solo para códigos.
- Acciones de fila como enlace, salvo la que importa (Continuar o Revisar).

## Colors

Neutros fríos de la familia Tailwind gray, un índigo y dos semánticos de dato.

### Primary
- **Índigo** (acento): botón primario, pestaña y píldora activas, barras de avance y valor elegido en escalas. Al pasar el cursor cambia a `acento-hover`. Contraste sobre blanco de aproximadamente 8:1.
- **Índigo lavado y suave**: fondo de la selección y del chip «Borrador».
- **Índigo claro**: tramo de borradores en barras y frutos opcionales en la cobertura.

### Neutral
- **fondo**: fondo de página. **superficie**: tarjetas. **superficie-2**: cajas de valor y hover de fila.
- **borde y borde-fila**: borde de tarjeta y separador de fila. **pista**: fondo de barras.
- **tinta, tinta-2, tinta-3 y tinta-4**: texto principal, secundario, terciario y metadato.

### Semánticos
- **falta o duda** (ámbar): descriptor obligatorio sin valor, «necesaria» o «necesario», celda «falta», no comparable, y un valor fuera del rango esperado («revisa»; no bloquea el guardado).
- **revisar** (rojo): métrica marcada y evaluación por revisar.
- **ok** (verde): completa y obligatoria cubierta.

### Named Rules
**La regla del ámbar.** El ámbar dice «dato faltante o dudoso»: aquí falta un dato, o hay uno que conviene revisar (por ejemplo «fuera del rango esperado: revisa»). No sirve para destacar, advertir en general ni decorar. (Decisión N8 de `docs/decisiones_cerradas.md`, 23-10-2026.)
**La regla de tinta-4.** `tinta-4` solo va sobre blanco (4,8:1). Sobre `fondo` se usa `tinta-3`.

## Typography

**Body Font:** Inter (con system-ui)
**Code Font:** JetBrains Mono, solo para códigos (02-014, P148, FEN·BRO).

**Character:** neutra y legible. Se lee como interfaz, no como terminal.

### Hierarchy
- **Título de página** (600, 20 px): uno por pantalla.
- **Título de sección** (600, 15 px): encabezado de tarjeta.
- **Cuerpo** (400, 14 px; 15 px en celular).
- **Secundario** (400, 13 px) y **etiqueta** (400, 12 px): metadatos y ayudas. Nunca menos de 12 px.
- **Cifra** (600, 18–24 px, tnum): valores registrados y puntajes.

**La regla de una negrita.** Por bloque, a lo sumo un elemento en 600. El resto se jerarquiza por tamaño y gris.

## Layout

Ancho máximo de 1360 px con márgenes de 24 px (16 px en celular). La separación entre tarjetas es de 16 px. En escritorio se usa contenido principal con una columna lateral de 300 a 320 px; debajo de 1100 px queda una sola columna. En celular el contenido va en una columna de hasta 480 px, con la acción principal fija abajo y la barra de navegación inferior.

## Elevation & Depth

Plano. La profundidad la dan el contraste entre `fondo` y `superficie` y los bordes de 1 px. No hay sombras en tarjetas; solo los controles segmentados activos llevan un relieve de 1 px.

## Shapes

Radio de 12 px en tarjetas, 8 px en controles, 10 px en controles de celular y píldora en chips y filtros. La sección activa del formulario lleva un borde índigo de 2 px.

## Components

### Buttons
- **Primario:** índigo sólido, texto blanco en 600, 44 px de alto. Hay uno por vista.
- **Secundario:** blanco con borde gris `#d1d5db`.
- **Acción de fila:** enlace con área de 44 px; «Continuar» y «Revisar» van como secundario (Revisar con borde rojo claro).

### Chips
- Píldora de 12 px con ícono y texto: Completa (verde), Cerrada (ámbar: faltan obligatorios), Revisar (rojo), Borrador (índigo suave), Sin empezar y Sin ronda (gris) y No evaluada (gris); el ámbar es «falta o duda».

### Filtros y pestañas
- Píldoras con `aria-pressed` y conteo; la activa va en índigo lavado con borde índigo.
- Pestañas subrayadas de 2 px para navegar dentro de la fase.

### Cobertura liviana
- En listas: «10/15» más una barra de 72 px segmentada por sección obligatoria, con ancho proporcional a sus descriptores. Si se cargaron frutos opcionales, se agrega un tramo índigo claro. El detalle completo aparece al pasar el cursor y en la ficha.

### Huella etiquetada
- En el detalle: una fila por sección con celdas de 12 px en cuatro estados. Medido es índigo lleno, faltó es ámbar con borde, no evaluado es blanco con borde y marcado es rojo con «!». Siempre lleva leyenda.

### Escalas 1–5
- Botones de 48 × 44 px en escritorio y de ancho completo × 52 px en celular, con `aria-pressed` y los extremos escritos debajo. No hay anclas intermedias.

## Do's and Don'ts

### Do:
- **Do** escribir el estado en texto junto a su color.
- **Do** usar monoespaciada solo para códigos.
- **Do** mantener 44 px de área táctil en todo control, incluidos los enlaces de fila.

### Don't:
- **Don't** mostrar cruzamiento, madre ni padre en vistas de operario.
- **Don't** mostrar puntajes fuera de la escala visible 0–100 con un decimal y coma (por dentro 0–1); usar siempre `lib/v3/puntaje.ts`.
- **Don't** inventar anclas de escala ni datos de hilera; si se muestran, se marcan como pendientes de confirmar.
- **Don't** usar sombras en tarjetas ni más de un botón sólido por vista.
