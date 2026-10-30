(() => {
let recorder, stream, chunks = [], epoch = 0;
const status = document.getElementById('status');
window.recorder.onStart(async (selected, recordingEpoch) => {
  if (recorder?.state === 'recording') return;
  const started = ++epoch;
  chunks = []; status.textContent = 'Opening microphone…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (started !== epoch) { stream.getTracks().forEach((track) => track.stop()); return; }
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      if (started !== epoch) return;
      stream.getTracks().forEach((track) => track.stop()); status.textContent = 'Transcribing…';
      try {
        const audio = new Uint8Array(await new Blob(chunks).arrayBuffer());
        if (started !== epoch) return;
        await window.recorder.transcribe({ audio, mime: recorder.mimeType.split(';')[0], model: selected }, recordingEpoch);
      } catch { status.textContent = 'Dictation failed. Check Desktop settings.'; setTimeout(() => window.recorder.cancel(), 3000); }
    };
    recorder.onstart = () => { status.textContent = 'Listening…'; };
    recorder.start();
  } catch { status.textContent = 'Allow microphone access in System Settings.'; setTimeout(() => window.recorder.cancel(), 3000); }
});
window.recorder.onStop(() => { if (recorder?.state === 'recording') recorder.stop(); else { stream?.getTracks().forEach((track) => track.stop()); window.recorder.cancel(); } });

window.recorder.onCancel(() => { epoch++; if (recorder) recorder.onstop = null; stream?.getTracks().forEach((track) => track.stop()); chunks = []; });
})();
