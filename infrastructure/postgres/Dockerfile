FROM postgres:16-alpine

RUN apk add --no-cache --virtual .build-deps git build-base clang llvm postgresql16-dev \
    && git clone --branch v0.8.1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector \
    && make OPTFLAGS="" with_llvm=no \
    && make with_llvm=no install \
    && cd / \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
