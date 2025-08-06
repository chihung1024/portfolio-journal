- name: Debug INTERNAL_API_KEY
  run: |
    python - <<'PY'
    import os, json
    key = os.getenv('INTERNAL_API_KEY')
    print('Key present:', bool(key))
    if key:
        # 只顯示前後四碼，避免洩漏完整金鑰
        print('Key preview:', key[:4] + '...' + key[-4:])
        print('Length:', len(key))          # 用來檢查是否有隱藏的 newline
        print('repr:', repr(key))           # 會顯示 \\n、\\r 等特殊字元
    PY
