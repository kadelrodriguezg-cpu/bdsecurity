-- Rollback del paso 59 («Pedir corrección»). Se niega si ya hay pedidos: quitar la tabla perdería quién pidió qué y por qué.
-- Si no, quita el disparador, las cuatro funciones y la tabla. Las filas de auditoría se conservan.
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pedido_correccion) THEN
    RAISE EXCEPTION 'FAIL: rollback 59: ya hay pedidos de corrección';
  END IF;
END;
$chk$;

drop trigger trg_evaluaciones_resolver_pedidos_correccion on public.evaluaciones;
drop function public.resolver_pedidos_correccion();
drop function public.pedidos_correccion_evaluacion(uuid);
drop function public.listar_correcciones_pedidas();
drop function public.pedir_correccion(uuid, text);
drop table public.pedido_correccion;
