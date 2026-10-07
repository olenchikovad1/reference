# Общее для отправки на машину: подключение из файла установки, ssh и scp.
# Подключается из ship-*.sh: `. deploy/release/_remote.sh <файл подключения> <каталог по умолчанию>`.
connection="${1:?нужен файл подключения}"
[ -f "$connection" ] || { echo "нет $connection — его кладёт установка (local/secrets/reference/)" >&2; exit 1; }
. "$connection"
: "${DEPLOY_HOST:?в $connection не задан DEPLOY_HOST}"
: "${DEPLOY_USER:?в $connection не задан DEPLOY_USER}"
port="${DEPLOY_PORT:-22}"
target="${DEPLOY_PATH:-$2}"
key=()
[ -n "${DEPLOY_KEY:-}" ] && key=(-i "$DEPLOY_KEY")
on_server() { ssh -p "$port" "${key[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"; }
send() {
  local to="$1"
  shift
  scp -q -P "$port" "${key[@]}" "$@" "$DEPLOY_USER@$DEPLOY_HOST:$target/$to"
}
# Образы архивом — на машину без хранилища образов: одним архивом на тег
# (`archives` контракта — шаблон с одним тегом). Все уже есть — не везём.
# send_images <архив без .tar.gz> <образ:тег>...
send_images() {
  local archive="$1" missing=()
  shift
  for image in "$@"; do
    on_server "docker image inspect $image >/dev/null 2>&1" || missing+=("$image")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "==> на машине уже есть $*"
    return
  fi
  echo "==> отправляю ${missing[*]}"
  docker save "${missing[@]}" | gzip | on_server "cat > $target/images/$archive.tar.gz && docker load -q -i $target/images/$archive.tar.gz >/dev/null"
}
