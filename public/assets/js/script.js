const startButton = document.getElementById("startTestButton");
const resetButton = document.getElementById("resetButton");
const statusText = document.getElementById("statusText");
const gauge = document.getElementById("gauge");
const gaugeValue = document.getElementById("gaugeValue");
const phaseLabel = document.getElementById("phaseLabel");
const currentMetricLabel = document.getElementById("currentMetricLabel");
const pingValue = document.getElementById("pingValue");
const downloadValue = document.getElementById("downloadValue");
const uploadValue = document.getElementById("uploadValue");
const latencyValue = document.getElementById("latencyValue");
const jitterValue = document.getElementById("jitterValue");
const lossValue = document.getElementById("lossValue");
const qualityLabel = document.getElementById("qualityLabel");
const historyList = document.getElementById("historyList");
const runtimeNotice = document.getElementById("runtimeNotice");

const historyEntries = [];
const testOrigin = window.location.origin;
const uploadPayloadBytes = 4 * 1024 * 1024;
let currentGaugeMax = 100;

function setGaugeState(state) {
  gauge.classList.toggle("is-running", state === "running");
  gauge.classList.toggle("has-results", state === "results");
}

function setGauge(value, max = currentGaugeMax) {
  const normalized = Math.min(Math.max(value, 0), max);
  const progress = (normalized / max) * 280;
  gauge.style.setProperty("--gauge-progress", `${progress}deg`);
  gaugeValue.textContent = normalized.toFixed(2);
}

function setStatus(title, phase, metricLabel = "Mbps") {
  statusText.textContent = title;
  phaseLabel.textContent = phase;
  currentMetricLabel.textContent = metricLabel;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatMbps(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "0 ms";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateGaugeScale(value, floor = 100) {
  const safeValue = Math.max(value, floor);
  const nextMax = safeValue < 100 ? 100 : Math.ceil(safeValue / 100) * 100;
  currentGaugeMax = Math.max(floor, nextMax);
}

function setLiveSpeed(value, floor = 100) {
  updateGaugeScale(value, floor);
  setGauge(value, currentGaugeMax);
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateQuality(download, upload, ping) {
  if (download > 900 && upload > 400 && ping < 10) {
    return "Excelente";
  }

  if (download > 400 && upload > 150 && ping < 18) {
    return "Muito boa";
  }

  if (download > 150 && upload > 50 && ping < 30) {
    return "Boa";
  }

  if (download > 50 && upload > 15) {
    return "Estavel";
  }

  return "Limitada";
}

async function ensureServerReady() {
  if (window.location.protocol === "file:") {
    throw new Error("Abra o app pelo servidor local, nao por file://.");
  }

  const response = await fetch(`${testOrigin}/health`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Servidor de teste indisponivel.");
  }
}

async function measurePing() {
  const samples = [];
  let failures = 0;

  setStatus("Medindo resposta da rede", "Analisando latencia", "ms");

  for (let index = 0; index < 10; index += 1) {
    const startedAt = performance.now();

    try {
      const response = await fetch(`${testOrigin}/ping?i=${index}&t=${Date.now()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Ping falhou.");
      }

      const elapsed = performance.now() - startedAt;
      samples.push(elapsed);
      setLiveSpeed(elapsed, 50);
    } catch (error) {
      failures += 1;
    }

    await sleep(90);
  }

  if (samples.length === 0) {
    throw new Error("Nao foi possivel medir o ping.");
  }

  const stableSamples = [...samples].sort((a, b) => a - b).slice(1, -1);
  const averagePing = average(stableSamples.length > 0 ? stableSamples : samples);
  const jitter = average((stableSamples.length > 0 ? stableSamples : samples).map((sample) => Math.abs(sample - averagePing)));
  const loss = (failures / 10) * 100;

  pingValue.textContent = Math.round(averagePing);
  latencyValue.textContent = formatMs(averagePing);
  jitterValue.textContent = `${jitter.toFixed(1)} ms`;
  lossValue.textContent = `${loss.toFixed(0)}%`;

  return {
    average: averagePing,
    jitter,
    loss,
  };
}

async function streamDownload(secondsLimit = 5, streamId = 0, onProgress = () => {}) {
  const response = await fetch(`${testOrigin}/download?duration=${secondsLimit}&stream=${streamId}&t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    throw new Error("Nao foi possivel iniciar o download.");
  }

  const reader = response.body.getReader();
  const startedAt = performance.now();
  let receivedBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    receivedBytes += value.byteLength;
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const currentMbps = ((receivedBytes * 8) / 1_000_000) / Math.max(elapsedSeconds, 0.1);
    onProgress({
      streamId,
      currentMbps,
      receivedBytes,
      elapsedSeconds,
    });

    if (elapsedSeconds >= secondsLimit) {
      await reader.cancel();
      break;
    }
  }

  const totalSeconds = (performance.now() - startedAt) / 1000;
  return ((receivedBytes * 8) / 1_000_000) / Math.max(totalSeconds, 0.1);
}

async function measureDownload() {
  setStatus("Testando download", "Recebendo dados em paralelo", "Mbps");

  const streamCount = 4;
  const streamSpeeds = new Array(streamCount).fill(0);

  const results = await Promise.all(
    Array.from({ length: streamCount }, (_, streamId) =>
      streamDownload(4, streamId, ({ currentMbps }) => {
        streamSpeeds[streamId] = currentMbps;
        const combinedSpeed = streamSpeeds.reduce((sum, speed) => sum + speed, 0);
        setLiveSpeed(combinedSpeed, 100);
        downloadValue.textContent = formatMbps(combinedSpeed);
      })
    )
  );

  const finalSpeed = results.reduce((sum, speed) => sum + speed, 0);
  downloadValue.textContent = formatMbps(finalSpeed);
  setLiveSpeed(finalSpeed, 100);
  return finalSpeed;
}

function createUploadPayload() {
  const payload = new Uint8Array(uploadPayloadBytes);
  const maxChunkSize = 65536;

  for (let offset = 0; offset < payload.length; offset += maxChunkSize) {
    const chunk = payload.subarray(offset, Math.min(offset + maxChunkSize, payload.length));
    crypto.getRandomValues(chunk);
  }

  return payload;
}

async function uploadOnce(payload, attempt) {
  const startedAt = performance.now();
  const response = await fetch(`${testOrigin}/upload?attempt=${attempt}&t=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error("Upload falhou.");
  }

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  return ((payload.byteLength * 8) / 1_000_000) / Math.max(elapsedSeconds, 0.1);
}

async function measureUpload() {
  setStatus("Testando upload", "Enviando dados em paralelo", "Mbps");

  const uploadCount = 2;
  const speeds = await Promise.all(
    Array.from({ length: uploadCount }, (_, attempt) => uploadOnce(createUploadPayload(), attempt))
  );

  let combinedSpeed = 0;
  speeds.forEach((speed) => {
    combinedSpeed += speed;
    setLiveSpeed(combinedSpeed, 100);
    uploadValue.textContent = formatMbps(combinedSpeed);
  });

  uploadValue.textContent = formatMbps(combinedSpeed);
  setLiveSpeed(combinedSpeed, 100);
  return combinedSpeed;
}

function renderHistory() {
  historyList.innerHTML = "";

  if (historyEntries.length === 0) {
    historyList.innerHTML = '<li class="history-empty">Nenhum teste executado ainda.</li>';
    return;
  }

  historyEntries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "history-item";
    item.innerHTML = `
      <strong>${entry.time}</strong><br>
      Down ${entry.download} Mbps • Up ${entry.upload} Mbps • Ping ${entry.ping} ms
    `;
    historyList.appendChild(item);
  });
}

function resetUi() {
  setGaugeState("idle");
  currentGaugeMax = 100;
  setStatus("Pronto para iniciar", "Aguardando", "Mbps");
  setGauge(0, currentGaugeMax);
  gaugeValue.textContent = "0.00";
  downloadValue.textContent = "0.00";
  uploadValue.textContent = "0.00";
  pingValue.textContent = "0";
  latencyValue.textContent = "0 ms";
  jitterValue.textContent = "0.0 ms";
  lossValue.textContent = "0%";
  qualityLabel.textContent = "Nao medida";
}

async function runSpeedTest() {
  startButton.disabled = true;
  resetButton.disabled = true;
  resetUi();
  setGaugeState("running");
  qualityLabel.textContent = "Medindo...";

  try {
    await ensureServerReady();
    const ping = await measurePing();
    await sleep(250);
    const download = await measureDownload();
    await sleep(250);
    const upload = await measureUpload();
    const quality = evaluateQuality(download, upload, ping.average);

    qualityLabel.textContent = quality;
    setStatus("Teste concluido", "Resultados atualizados", "Mbps");
    setLiveSpeed(download, 100);
    setGaugeState("results");

    historyEntries.unshift({
      time: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      download: formatMbps(download),
      upload: formatMbps(upload),
      ping: Math.round(ping.average),
    });

    historyEntries.splice(4);
    renderHistory();
  } catch (error) {
    setStatus("Falha ao testar", error.message || "Servidor indisponivel", "Mbps");
    qualityLabel.textContent = "Indisponivel";
    setGaugeState("idle");
  } finally {
    startButton.disabled = false;
    resetButton.disabled = false;
  }
}

startButton.addEventListener("click", runSpeedTest);

resetButton.addEventListener("click", () => {
  historyEntries.length = 0;
  renderHistory();
  resetUi();
});

renderHistory();
resetUi();

if (window.location.protocol === "file:") {
  runtimeNotice.textContent = "Abra via servidor local com `npm start` e acesse http://127.0.0.1:3000 para o teste real.";
} else {
  runtimeNotice.textContent = `Servidor conectado em ${window.location.host}. Os resultados agora usam ping, download e upload reais no servidor local.`;
}

