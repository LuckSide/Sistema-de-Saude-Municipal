FROM python:3.13-alpine AS build

WORKDIR /code

# Só no stage de build (não vai p/ runtime): toolchain p/ compilar
# qualquer extensão C sem wheel musl.
RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache build-base postgresql-dev libffi-dev \
    && rm -rf /var/cache/apk/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.13-alpine AS runtime

WORKDIR /code

RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache libpq libffi openssh-client \
    && rm -rf /var/cache/apk/* \
    && addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=build /usr/local/bin /usr/local/bin

# Poda ferramentas de build do runtime: pip/setuptools/wheel carregam cópias
# vendored vulneráveis (urllib3, msgpack, setuptools) que o Scout sinaliza
# como HIGH. Nada em runtime precisa delas.
RUN rm -rf /usr/local/lib/python3.13/site-packages/pip \
    /usr/local/lib/python3.13/site-packages/pip-*.dist-info \
    /usr/local/lib/python3.13/site-packages/setuptools \
    /usr/local/lib/python3.13/site-packages/setuptools-*.dist-info \
    /usr/local/lib/python3.13/site-packages/wheel \
    /usr/local/lib/python3.13/site-packages/wheel-*.dist-info \
    /usr/local/lib/python3.13/site-packages/_distutils_hack \
    /usr/local/lib/python3.13/site-packages/distutils-precedence.pth \
    /usr/local/lib/python3.13/site-packages/pkg_resources

COPY app ./app
COPY gunicorn_conf.py ./gunicorn_conf.py

RUN chown -R appuser:appgroup /code

USER appuser

EXPOSE 8000

CMD ["python", "-m", "gunicorn", "-c", "gunicorn_conf.py", "app.main:app"]
