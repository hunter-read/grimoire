"""Audio formats as the browser's <audio> element expects them."""

# Map audio extensions to the mimetype the browser <audio> element expects.
AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    # Audiobooks: the same container as .m4a, so the same player handles them.
    ".m4b": "audio/mp4",
    ".aac": "audio/aac",
}
