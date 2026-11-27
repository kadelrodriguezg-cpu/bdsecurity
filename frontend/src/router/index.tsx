import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { EspacioEspecieLayout } from '@/features/especies/EspacioEspecie';
import { AppShell } from '@/components/shell/AppShell';
import { ActualizacionApp } from '@/components/shared/ActualizacionApp';
import { SeccionLayout } from '@/components/shell/SeccionLayout';
import { IMPORTADOR_CRUCES_VISIBLE } from '@/lib/funcionalidades';
import { RedireccionDashboard, RedireccionRanking, RedireccionVisualizaciones } from './redirecciones';
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ResultadosPage = lazy(() => import('@/pages/ResultadosPage').then((m) => ({ default: m.ResultadosPage })));
const MapaTerritorialPage = lazy(() => import('@/pages/resultados/OtrasVistasPages').then((m) => ({ default: m.MapaTerritorialPage })));
const TendenciasPage = lazy(() => import('@/pages/resultados/OtrasVistasPages').then((m) => ({ default: m.TendenciasPage })));
const PolinizacionVariedadPage = lazy(() => import('@/pages/resultados/OtrasVistasPages').then((m) => ({ default: m.PolinizacionVariedadPage })));
const PlantasListaPage = lazy(() => import('@/pages/PlantasListaPage').then((m) => ({ default: m.PlantasListaPage })));
const PlantaFichaPage = lazy(() => import('@/pages/PlantaFichaPage').then((m) => ({ default: m.PlantaFichaPage })));
const IndividuoDestinoPage = lazy(() => import('@/pages/IndividuoDestinoPage').then((m) => ({ default: m.IndividuoDestinoPage })));
const EscanearQRPage = lazy(() => import('@/pages/EscanearQRPage').then((m) => ({ default: m.EscanearQRPage })));
const UsuariosPage = lazy(() => import('@/pages/UsuariosPage').then((m) => ({ default: m.UsuariosPage })));
const PerfilPage = lazy(() => import('@/pages/PerfilPage').then((m) => ({ default: m.PerfilPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const NuevaPlantaPage = lazy(() => import('@/pages/NuevaPlantaPage').then((m) => ({ default: m.NuevaPlantaPage })));
const CatalogosPage = lazy(() => import('@/pages/CatalogosPage').then((m) => ({ default: m.CatalogosPage })));
const CruzamientosAdminPage = lazy(() => import('@/pages/CruzamientosAdminPage').then((m) => ({ default: m.CruzamientosAdminPage })));
const ImportarCrucesPage = lazy(() => import('@/pages/ImportarCrucesPage').then((m) => ({ default: m.ImportarCrucesPage })));
const EnsayosListaPage = lazy(() => import('@/pages/EnsayosListaPage').then((m) => ({ default: m.EnsayosListaPage })));
const EnsayoDetallePage = lazy(() => import('@/pages/EnsayoDetallePage').then((m) => ({ default: m.EnsayoDetallePage })));
const FichaEveclPage = lazy(() => import('@/pages/FichaEveclPage').then((m) => ({ default: m.FichaEveclPage })));
const FichaEveclEditarPage = lazy(() => import('@/pages/FichaEveclEditarPage').then((m) => ({ default: m.FichaEveclEditarPage })));
const EveclCompararPage = lazy(() => import('@/pages/EveclCompararPage').then((m) => ({ default: m.EveclCompararPage })));
const EveclReferenciaPage = lazy(() => import('@/pages/EveclReferenciaPage').then((m) => ({ default: m.EveclReferenciaPage })));
const EvaluacionPasadaPage = lazy(() => import('@/pages/EvaluacionPasadaPage').then((m) => ({ default: m.EvaluacionPasadaPage })));
const CompararRondasPage = lazy(() => import('@/pages/CompararRondasPage').then((m) => ({ default: m.CompararRondasPage })));
const EvaluarIndividuoPage = lazy(() => import('@/pages/EvaluarIndividuoPage').then((m) => ({ default: m.EvaluarIndividuoPage })));
const EvaluarCrecimientoPage = lazy(() => import('@/pages/EvaluarCrecimientoPage').then((m) => ({ default: m.EvaluarCrecimientoPage })));
const EveclModuloLayout = lazy(() => import('@/features/evecl/EveclModuloLayout').then((m) => ({ default: m.EveclModuloLayout })));

export function AppRouter() {
  return (
    <BrowserRouter>
      {/* Revisa si hay versión nueva; recarga sola solo sin cambios sin guardar (lib/actualizacionApp). */}
      <ActualizacionApp />
      <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-10 text-sm text-ink-3">Cargando pantalla…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Todo lo demás requiere sesión */}
        <Route element={<ProtectedRoute />}>
          {/* Fase 4: todo lo que requiere sesión trabaja dentro de una especie (o en «Todas las especies»). */}
          <Route element={<EspacioEspecieLayout />}>
          {/* Evaluación a pantalla completa: fuera del layout (sin barra inferior que tape el botón fijo). */}
          <Route path="/planta/:id/evaluar/:individuoId" element={<EvaluarIndividuoPage />} />
          <Route path="/planta/:id/multisitio/:individuoId" element={<EvaluarIndividuoPage tipo="multisitio" />} />
          <Route path="/planta/:id/crecimiento/:individuoId" element={<EvaluarCrecimientoPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            {/* Resultados v3 (N19, N33): una sola tabla y sus «otras vistas». Las rutas viejas redirigen al estado equivalente (N21). */}
            <Route path="/resultados" element={<ResultadosPage />} />
            <Route path="/resultados/mapa" element={<MapaTerritorialPage />} />
            <Route path="/resultados/tendencias" element={<TendenciasPage />} />
            <Route path="/resultados/polinizacion" element={<PolinizacionVariedadPage />} />
            <Route path="/ranking" element={<RedireccionRanking />} />
            <Route path="/dashboard" element={<RedireccionDashboard />} />
            <Route path="/visualizaciones" element={<RedireccionVisualizaciones />} />
            <Route path="/plantas" element={<PlantasListaPage />} />
            <Route path="/planta/:id" element={<PlantaFichaPage />} />
            <Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} />
            <Route path="/planta/:id/comparar/:individuoId" element={<CompararRondasPage />} />
            <Route path="/individuo/:id" element={<IndividuoDestinoPage />} />
            <Route path="/escanear" element={<EscanearQRPage />} />
            <Route path="/perfil" element={<PerfilPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/planta/:plantaId" element={<ChatPage />} />
            <Route path="/evecl" element={<EveclModuloLayout />}>
              <Route index element={<EnsayosListaPage />} />
              <Route path="ensayos/:id" element={<EnsayoDetallePage />} />
              <Route path="fichas/:id" element={<FichaEveclPage />} />
              <Route path="fichas/:id/editar" element={<FichaEveclEditarPage />} />
              <Route path="comparar" element={<EveclCompararPage />} />
              <Route path="referencia" element={<EveclReferenciaPage />} />
            </Route>

            {/* Solo admin */}
            <Route element={<AdminRoute />}>
              <Route path="/nueva-planta" element={<NuevaPlantaPage />} />
              {/* v3 paso 6: Especies es una pestaña de Catálogos. */}
              <Route path="/nueva-especie" element={<Navigate to="/catalogos?tipo=especies" replace />} />
              <Route path="/administracion" element={<Navigate to="/cruzamientos" replace />} />
              <Route element={<SeccionLayout destino="administracion" />}>
                <Route path="/usuarios" element={<UsuariosPage />} />
                <Route path="/catalogos" element={<CatalogosPage />} />
                <Route path="/cruzamientos" element={<CruzamientosAdminPage />} />
                {IMPORTADOR_CRUCES_VISIBLE && <Route path="/importar-cruces" element={<ImportarCrucesPage />} />}
              </Route>
            </Route>
          </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
