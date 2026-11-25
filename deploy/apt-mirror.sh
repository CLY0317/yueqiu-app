#!/bin/sh
# 把 Debian 源换成阿里云镜像：官方源在国内慢到能把一次镜像构建拖到半小时以上。
# 用法：在每个 stage 里 apt-get update 之前调用。
#
# 注意用 http 而不是 https：node:*-slim 基础镜像里没有 ca-certificates，
# 用 https 会在装证书之前就因证书校验失败而报错（鸡生蛋）。
set -e
for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do
  [ -f "$f" ] || continue
  sed -i \
    -e 's|https\?://deb\.debian\.org/debian|http://mirrors.aliyun.com/debian|g' \
    -e 's|https\?://security\.debian\.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
    "$f"
done
