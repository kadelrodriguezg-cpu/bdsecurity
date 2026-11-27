const MAX_LADO = 1600;
const CALIDAD_JPEG = 0.82;

function canvasABlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la foto.')),
      'image/jpeg',
      CALIDAD_JPEG,
    );
  });
}

async function cargarImagen(archivo: File): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number; cerrar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    return { fuente: bitmap, ancho: bitmap.width, alto: bitmap.height, cerrar: () => bitmap.close() };
  }

  const url = URL.createObjectURL(archivo);
  const imagen = new Image();
  await new Promise<void>((resolve, reject) => {
    imagen.onload = () => resolve();
    imagen.onerror = () => reject(new Error('No se pudo leer la foto seleccionada.'));
    imagen.src = url;
  });
  return {
    fuente: imagen,
    ancho: imagen.naturalWidth,
    alto: imagen.naturalHeight,
    cerrar: () => URL.revokeObjectURL(url),
  };
}

/** Convierte cualquier imagen aceptada por el navegador a JPEG acotado, sin base64. */
export async function comprimirFotoEvecl(archivo: File): Promise<File> {
  if (!archivo.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
  const imagen = await cargarImagen(archivo);
  try {
    const escala = Math.min(1, MAX_LADO / Math.max(imagen.ancho, imagen.alto));
    const ancho = Math.max(1, Math.round(imagen.ancho * escala));
    const alto = Math.max(1, Math.round(imagen.alto * escala));
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const contexto = canvas.getContext('2d');
    if (!contexto) throw new Error('Este navegador no permite comprimir la foto.');
    contexto.drawImage(imagen.fuente, 0, 0, ancho, alto);
    const blob = await canvasABlob(canvas);
    const nombreBase = archivo.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${nombreBase}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    imagen.cerrar();
  }
}
