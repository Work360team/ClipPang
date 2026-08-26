#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

/bin/sh "$SCRIPT_DIR/start.sh"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo ""
  printf "เปิด Clip360 ไม่สำเร็จ กด Enter เพื่อปิดหน้าต่าง..."
  read -r _ANSWER
fi

exit "$STATUS"
