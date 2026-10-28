FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
ARG LO_VERSION=4:7.4.7-1+deb12u14
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress=${LO_VERSION} python3 fonts-liberation fonts-dejavu-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --no-create-home converter
COPY workers/pptx/worker.py workers/pptx/validate.py /opt/pptx/
USER 1000:1000
ENV HOME=/tmp SAL_USE_VCLPLUGIN=svp PYTHONDONTWRITEBYTECODE=1
WORKDIR /tmp
ENTRYPOINT ["python3", "/opt/pptx/worker.py"]
