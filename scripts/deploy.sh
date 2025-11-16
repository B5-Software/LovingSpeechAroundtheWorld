#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/start.js"
DEFAULT_NAME_PREFIX="lovingspeech"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[deploy] 错误：未找到 pm2，请先安装 (npm i -g pm2)。" >&2
  exit 1
fi

declare -A MODE_LABELS=(
  [directory]="Directory Authority"
  [relay]="Relay Node"
  [client]="Client Studio"
  [relay-client]="Relay + Client"
  [directory-relay-client]="Directory + Relay + Client"
)

declare -A MODE_SERVICES=(
  [directory]="directory"
  [relay]="relay"
  [client]="client"
  [relay-client]="relay client"
  [directory-relay-client]="directory relay client"
)

declare -A SERVICE_DEFAULT_PORTS=(
  [directory]=4600
  [relay]=4700
  [client]=4800
)

MODE_OPTIONS=(directory relay client relay-client directory-relay-client)

function prompt_mode() {
  echo "========================================"
  echo "🌌 Loving Speech Around the World 部署向导"
  echo "========================================"
  echo "请选择要部署的运行模式："
  for i in "${!MODE_OPTIONS[@]}"; do
    local key="${MODE_OPTIONS[$i]}"
    printf " %d) %s (%s)\n" "$((i + 1))" "$key" "${MODE_LABELS[$key]}"
  done
  while true; do
    read -rp "输入序号（默认 4 = relay-client）：" choice
    choice=${choice:-4}
    if [[ $choice =~ ^[1-5]$ ]]; then
      MODE_SELECTED="${MODE_OPTIONS[$((choice - 1))]}"
      echo "已选择：${MODE_LABELS[$MODE_SELECTED]}"
      return
    fi
    echo "无效选择，请重新输入。"
  done
}

function prompt_port() {
  local service=$1
  local default=${SERVICE_DEFAULT_PORTS[$service]}
  while true; do
    read -rp "为 ${service} 服务设置端口 (默认 ${default})：" value
    value=${value:-$default}
    if [[ $value =~ ^[0-9]+$ ]] && ((value > 0 && value < 65536)); then
      PORT_MAP[$service]=$value
      return
    fi
    echo "端口无效，请输入 1-65535 之间的数字。"
  done
}

function confirm() {
  local prompt=$1
  local default_answer=${2:-Y}
  local default_hint="Y/n"
  [[ $default_answer == "N" ]] && default_hint="y/N"
  while true; do
    read -rp "${prompt} (${default_hint}): " reply
    reply=${reply:-$default_answer}
    case "$reply" in
      [Yy]) return 0 ;;
      [Nn]) return 1 ;;
    esac
    echo "请输入 y/n。"
  done
}

prompt_mode

declare -A PORT_MAP=()

function collect_ports_for_mode() {
  local services_string=${MODE_SERVICES[$MODE_SELECTED]:-}
  if [[ -z $services_string ]]; then
    echo "[deploy] 错误：未找到模式 ${MODE_SELECTED} 对应的服务定义。" >&2
    exit 1
  fi
  read -r -a REQUIRED_SERVICES <<< "$services_string"
  if [[ ${#REQUIRED_SERVICES[@]} -eq 0 ]]; then
    echo "[deploy] 错误：模式 ${MODE_SELECTED} 未配置任何服务。" >&2
    exit 1
  fi
  for svc in "${REQUIRED_SERVICES[@]}"; do
    prompt_port "$svc"
  done
}

collect_ports_for_mode

read -rp "为该进程设置名称 (默认 ${DEFAULT_NAME_PREFIX}-${MODE_SELECTED}): " PROC_NAME
PROC_NAME=${PROC_NAME:-${DEFAULT_NAME_PREFIX}-${MODE_SELECTED}}

declare -a ENV_VARS=("APP_MODE=${MODE_SELECTED}")
for svc in directory relay client; do
  if [[ -n ${PORT_MAP[$svc]:-} ]]; then
    ENV_VARS+=("${svc^^}_PORT=${PORT_MAP[$svc]}")
  fi
done

printf '\n>>> 启动 PM2 进程 %s...\n' "$PROC_NAME"
env "${ENV_VARS[@]}" pm2 start "$SCRIPT_PATH" \
  --name "$PROC_NAME" \
  --cwd "$ROOT_DIR" \
  --interpreter node

printf '\n当前 PM2 进程：\n'
pm2 ls || true

if confirm "是否保存当前 PM2 进程列表以便重启自动恢复？" Y; then
  pm2 save
fi

if confirm "是否配置 PM2 开机自启？需要 sudo 权限" N; then
  pm2 startup
  echo "PM2 启动命令已生成，请根据提示执行 sudo 命令完成注册。"
fi

printf '\n部署完成。可通过以下命令管理进程：\n'
echo "  pm2 logs ${PROC_NAME}"
echo "  pm2 restart ${PROC_NAME}"
echo "  pm2 stop ${PROC_NAME}"
echo "  pm2 delete ${PROC_NAME}"
