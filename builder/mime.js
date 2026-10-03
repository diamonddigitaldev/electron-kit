"use strict";

// The MIME types Linux knows each file extension by, from freedesktop.org's
// shared-mime-info: the type its database gives the extension first, then the
// other names a file of it is found as (a subclass, or a name some desktops
// still use). The app's .desktop file lists them all, so it's in the file
// manager's Open With for each, whatever its database calls the file.
//
// An extension that isn't here is given its types by the app
// (config()'s fileTypes, `mimeTypes`).

const MIME_TYPES = Object.freeze({
    // Audio
    aac: ["audio/aac", "audio/x-aac"],
    aiff: ["audio/x-aiff"],
    flac: ["audio/flac", "audio/x-flac"],
    m4a: ["audio/mp4", "audio/x-m4a"],
    mka: ["audio/x-matroska"],
    mp3: ["audio/mpeg", "audio/mp3"],
    oga: ["audio/ogg"],
    ogg: ["audio/ogg", "audio/x-vorbis+ogg", "audio/x-flac+ogg", "audio/x-opus+ogg"],
    opus: ["audio/x-opus+ogg", "audio/ogg"],
    wav: ["audio/x-wav", "audio/wav"],
    weba: ["audio/webm"],
    wma: ["audio/x-ms-wma"],
    // Video
    "3gp": ["video/3gpp"],
    avi: ["video/x-msvideo"],
    flv: ["video/x-flv"],
    m4v: ["video/x-m4v", "video/mp4"],
    mkv: ["video/x-matroska"],
    mov: ["video/quicktime"],
    mp4: ["video/mp4"],
    mpeg: ["video/mpeg"],
    mpg: ["video/mpeg"],
    ogv: ["video/ogg"],
    ts: ["video/mp2t"],
    webm: ["video/webm"],
    wmv: ["video/x-ms-wmv"],
    // Images
    avif: ["image/avif"],
    bmp: ["image/bmp"],
    gif: ["image/gif"],
    heic: ["image/heif"],
    ico: ["image/vnd.microsoft.icon"],
    jpeg: ["image/jpeg"],
    jpg: ["image/jpeg"],
    png: ["image/png"],
    svg: ["image/svg+xml"],
    tif: ["image/tiff"],
    tiff: ["image/tiff"],
    webp: ["image/webp"],
    // Text and documents
    csv: ["text/csv"],
    json: ["application/json"],
    md: ["text/markdown"],
    pdf: ["application/pdf"],
    txt: ["text/plain"],
});

/** Every file, for an app that takes any file (config()'s allFiles): every type is a kind of it. */
const ALL_FILES = "application/octet-stream";

module.exports = { MIME_TYPES, ALL_FILES };
