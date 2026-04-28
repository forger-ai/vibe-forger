# AGENTS

## Fuente de verdad

Este archivo describe el comportamiento real de Vibe Forger para agentes.

`manifest.json` describe instalacion, servicios, stack, permisos y scripts. No debe tratarse como una lista completa de capacidades visibles para el usuario.

Las herramientas internas, scripts y endpoints son medios de operacion. El usuario final debe recibir explicaciones funcionales, no instrucciones para ejecutar comandos o manipular rutas internas.

## Identidad del producto

- id: `vibe-forger`
- nombre visible: `Vibe Forger`
- tipo: mini IDE local
- stack: `vite-fastapi-sqlite`

Vibe Forger es una app local para explorar y editar archivos de texto dentro de un root autorizado. El root puede ser el workspace interno privado de la app o una carpeta externa seleccionada explicitamente por el usuario desde Forger Desktop.

## Capacidades visibles para el usuario

### Abrir un workspace

El usuario puede:

- abrir una carpeta externa mediante un dialogo explicito de Forger Desktop;
- usar el workspace interno privado de la app.

Si la app no esta corriendo dentro de Forger Desktop, la seleccion externa no esta disponible. En ese caso, la app sigue pudiendo usar el workspace interno.

### Explorar archivos

El usuario puede ver una estructura de carpetas y archivos dentro del root activo.

La app no muestra ni lee contenido fuera de ese root. Si una entrada es un symlink que apunta fuera del root autorizado, el backend la bloquea.

### Leer y editar texto

El usuario puede abrir archivos de texto UTF-8 dentro del root activo, editarlos con Monaco y guardar cambios.

La app rechaza:

- rutas absolutas;
- path traversal;
- symlinks fuera del root;
- archivos grandes;
- archivos binarios;
- archivos que no se pueden decodificar como UTF-8.

Cuando un archivo es rechazado, la UI muestra un error claro y mantiene el editor estable.

### Crear, renombrar y eliminar

El usuario puede crear archivos, crear carpetas, renombrar entradas y eliminar archivos o carpetas dentro del root activo.

La eliminacion pasa por una confirmacion visible antes de ejecutar la accion destructiva.

## Limites que no debes asumir

No afirmar que Vibe Forger incluye:

- terminal integrada;
- ejecucion de comandos;
- depuracion;
- Git;
- extensiones;
- marketplace;
- LSP o autocompletado avanzado;
- acceso silencioso a carpetas externas;
- lectura de archivos fuera del root autorizado.

Si el usuario pide cualquiera de esas capacidades, responde que no forman parte del alcance actual y plantea la mejora como un cambio de producto si corresponde.

## Seguridad de filesystem

El backend es la autoridad de filesystem.

Reglas vigentes:

- El estado inicial no tiene root seleccionado.
- `POST /api/workspace/internal` autoriza el workspace privado de la app.
- `POST /api/workspace/external` autoriza una carpeta externa solo si recibe un grant temporal firmado por Forger Desktop.
- Las operaciones de filesystem reciben rutas relativas POSIX.
- Rutas absolutas, `..`, backslashes y paths vacios para entradas nuevas se rechazan.
- Para paths existentes, el backend resuelve el path real y verifica que siga dentro del root autorizado.
- Symlinks que resuelven fuera del root se rechazan.
- El limite de lectura/escritura de texto es 1 MiB.
- El backend solo acepta texto UTF-8 y bloquea archivos con bytes nulos al comienzo.

## API interna

Endpoints principales:

- `GET /api/workspace`
- `POST /api/workspace/internal`
- `POST /api/workspace/external`
- `GET /api/fs/tree`
- `GET /api/fs/read`
- `PUT /api/fs/write`
- `POST /api/fs/create`
- `POST /api/fs/rename`
- `DELETE /api/fs/delete`

No presentes estos endpoints como pasos normales para el usuario final.

## Integracion con Forger Desktop

Vibe Forger usa una API minima expuesta por la ventana de app:

- `window.forgerApp.selectExternalFolder()`

Esa API abre el dialogo nativo de carpeta desde desktop y devuelve:

- path real seleccionado;
- token temporal firmado;
- vencimiento del token.

El backend valida el token con `FORGER_APP_GRANT_SECRET` y `FORGER_APP_ID`, que desktop inyecta al proceso backend al abrir la app.

## Verificacion

Checks relevantes:

- backend: `docker compose run --rm backend uv run --extra dev python scripts/verify.py`
- frontend: `docker compose run --rm --no-deps frontend npm run build`

Tambien existe workflow de CI con esos checks.

Estos comandos son herramientas internas del agente. Hacia el usuario final, reporta el resultado funcional de las verificaciones.
