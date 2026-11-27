#!/usr/bin/env bash
# Aplica a la base LOCAL (contenedor de Supabase del proyecto) las migraciones de supabase/migrations/ que todavía no tiene,
# en orden, cada una en una transacción, y registra su versión. Rodeo del error de «supabase migration up --local» con versiones
# fantasma. Nunca toca producción: solo habla con el contenedor local.
#   bash scripts/aplicar_local.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CTR="supabase_db_dbsecurity-frutales"
for f in $(ls "$RAIZ/supabase/migrations" | sort); do
  v="${f%%_*}"; n="${f#*_}"; n="${n%.sql}"
  if [ "$(docker exec "$CTR" psql -U postgres -At -c "select count(*) from supabase_migrations.schema_migrations where version = '$v'")" = 0 ]; then
    echo "Aplicando $f"
    { cat "$RAIZ/supabase/migrations/$f"; printf "\ninsert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s');\n" "$v" "$n"; } \
      | docker exec -i "$CTR" psql -U postgres -X -q -v ON_ERROR_STOP=1 -1
  fi
done
docker exec "$CTR" psql -U postgres -At -c "notify pgrst, 'reload schema'" >/dev/null
echo "Versiones locales: $(docker exec "$CTR" psql -U postgres -At -c "select count(*) from supabase_migrations.schema_migrations")"
