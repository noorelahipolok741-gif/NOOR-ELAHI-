package com.noorelahi.learning;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "NoorStorage",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_IMAGES },
            alias = "media33"
        ),
        @Permission(
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE },
            alias = "legacyRead"
        ),
        @Permission(
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE },
            alias = "legacyStorage"
        )
    }
)
public class NoorStoragePlugin extends Plugin {

    private static final String PREFS_NAME = "noor_storage_prefs";
    private static final String KEY_TREE_URIS = "saf_tree_uris";
    private static final String DEFAULT_SUBFOLDER = "NoorElahi";

    private final ExecutorService executor = Executors.newCachedThreadPool();

    private String getRuntimePermissionAlias() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return "media33";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return "legacyRead";
        }
        return "legacyStorage";
    }

    private boolean isRuntimeMediaPermissionGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (getPermissionState("media33") == PermissionState.GRANTED) {
                return true;
            }
            Context ctx = getContext();
            if (ctx == null) return false;
            boolean hasVideo =
                ctx.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) == android.content.pm.PackageManager.PERMISSION_GRANTED;
            boolean hasVisualSelected =
                Build.VERSION.SDK_INT >= 34 &&
                ctx.checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == android.content.pm.PackageManager.PERMISSION_GRANTED;
            return hasVideo || hasVisualSelected;
        }
        return getPermissionState(getRuntimePermissionAlias()) == PermissionState.GRANTED;
    }

    private boolean hasAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true;
    }

    private Set<String> getPersistedTreeUriStrings() {
        Set<String> result = new HashSet<>();
        Context ctx = getContext();
        if (ctx == null) return result;
        List<UriPermission> perms = ctx.getContentResolver().getPersistedUriPermissions();
        for (UriPermission perm : perms) {
            if (perm.isReadPermission() && perm.getUri() != null) {
                result.add(perm.getUri().toString());
            }
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> saved = prefs.getStringSet(KEY_TREE_URIS, null);
        if (saved != null) {
            for (String s : saved) {
                if (result.contains(s)) {
                    result.add(s);
                }
            }
        }
        return result;
    }

    private void savePersistedTreeUri(Uri uri) {
        Context ctx = getContext();
        if (ctx == null || uri == null) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> existing = new HashSet<>(prefs.getStringSet(KEY_TREE_URIS, new HashSet<>()));
        existing.add(uri.toString());
        prefs.edit().putStringSet(KEY_TREE_URIS, existing).apply();
    }

    private JSObject buildPermissionStatusObject() {
        boolean runtimeGranted = isRuntimeMediaPermissionGranted();
        boolean allFiles = hasAllFilesAccess();
        boolean hasFolderTree = !getPersistedTreeUriStrings().isEmpty();
        boolean granted = runtimeGranted || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && allFiles) || hasFolderTree;
        boolean needsFolderGrantForPdf =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !allFiles && !hasFolderTree;

        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("runtimeGranted", runtimeGranted);
        res.put("hasAllFilesAccess", allFiles);
        res.put("hasSavedFolderTree", hasFolderTree);
        res.put("needsFolderGrantForPdf", needsFolderGrantForPdf);
        res.put("sdkInt", Build.VERSION.SDK_INT);
        return res;
    }

    @PluginMethod
    public void checkMediaPermissions(PluginCall call) {
        call.resolve(buildPermissionStatusObject());
    }

    @PluginMethod
    public void requestMediaPermissions(PluginCall call) {
        if (isRuntimeMediaPermissionGranted()) {
            call.resolve(buildPermissionStatusObject());
            return;
        }
        requestPermissionForAlias(getRuntimePermissionAlias(), call, "mediaPermCallback");
    }

    @PermissionCallback
    private void mediaPermCallback(PluginCall call) {
        if (call == null) return;
        call.resolve(buildPermissionStatusObject());
    }

    @PluginMethod
    public void pickPublicFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri downloadInitialUri = Uri.parse(
                "content://com.android.externalstorage.documents/document/primary%3ADownload"
            );
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, downloadInitialUri);
        }
        startActivityForResult(call, intent, "handleFolderPickResult");
    }

    @ActivityCallback
    private void handleFolderPickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject out = buildPermissionStatusObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        Uri treeUri = result.getData().getData();
        if (treeUri != null && getContext() != null) {
            int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            try {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
            } catch (SecurityException e) {
                try {
                    getContext()
                        .getContentResolver()
                        .takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (SecurityException ignored) {
                    // Ignore if persistable permission is unavailable on provider
                }
            }
            savePersistedTreeUri(treeUri);
        }
        JSObject out = buildPermissionStatusObject();
        out.put("cancelled", false);
        if (treeUri != null) {
            out.put("treeUri", treeUri.toString());
        }
        call.resolve(out);
    }

    @PluginMethod
    public void openAllFilesSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || getContext() == null) {
            call.resolve(buildPermissionStatusObject());
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "handleAllFilesSettingsResult");
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                startActivityForResult(call, fallback, "handleAllFilesSettingsResult");
            } catch (Exception ex) {
                call.resolve(buildPermissionStatusObject());
            }
        }
    }

    @ActivityCallback
    private void handleAllFilesSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(buildPermissionStatusObject());
    }

    private static String sanitizeFilename(String raw) {
        String base = raw == null ? "noor_elahi_file" : raw.trim();
        base = base.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]+", "_").trim();
        if (base.isEmpty()) return "noor_elahi_file";
        return base;
    }

    private static String inferMimeType(String filename, String providedMime) {
        if (providedMime != null && !providedMime.trim().isEmpty()) {
            return providedMime.trim();
        }
        String lower = filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mov")) return "video/quicktime";
        return "video/mp4";
    }

    private static String detectKind(String filename, String mimeType) {
        String lowerName = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        String lowerMime = mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT);
        if (lowerName.endsWith(".pdf") || lowerMime.equals("application/pdf")) {
            return "pdf";
        }
        if (
            lowerName.endsWith(".mp4") ||
            lowerName.endsWith(".mkv") ||
            lowerName.endsWith(".webm") ||
            lowerName.endsWith(".mov") ||
            lowerName.endsWith(".m4v") ||
            lowerName.endsWith(".avi") ||
            lowerName.endsWith(".3gp") ||
            lowerName.endsWith(".flv") ||
            lowerName.endsWith(".ts") ||
            lowerMime.startsWith("video/")
        ) {
            return "video";
        }
        return null;
    }

    private static final class PublicWriteTarget {
        Uri mediaUri;
        File legacyFile;
        String folderLabel;
        boolean newlyCreatedMediaStoreRow;
    }

    private PublicWriteTarget openPublicDownloadTarget(String safeName, String mimeType, String subfolder)
        throws IOException {
        Context ctx = getContext();
        if (ctx == null) {
            throw new IOException("Context unavailable");
        }
        String cleanSub = (subfolder == null || subfolder.trim().isEmpty())
            ? DEFAULT_SUBFOLDER
            : sanitizeFilename(subfolder);
        PublicWriteTarget target = new PublicWriteTarget();
        target.folderLabel = "Download/" + cleanSub;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = ctx.getContentResolver();
            String relPath = Environment.DIRECTORY_DOWNLOADS + "/" + cleanSub;

            // Reuse/overwrite an existing file owned by our app so we avoid "(1)", "(2)" clutter
            Uri existingUri = findOwnedMediaStoreDownloadUri(resolver, safeName, relPath);
            if (existingUri != null) {
                target.mediaUri = existingUri;
                target.newlyCreatedMediaStoreRow = false;
                return target;
            }

            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, relPath);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri inserted = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (inserted == null) {
                throw new IOException("Failed to create MediaStore download entry");
            }
            target.mediaUri = inserted;
            target.newlyCreatedMediaStoreRow = true;
            return target;
        }

        File dlRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File noorDir = new File(dlRoot, cleanSub);
        if (!noorDir.exists() && !noorDir.mkdirs()) {
            throw new IOException("Failed to create Download/" + cleanSub);
        }
        target.legacyFile = new File(noorDir, safeName);
        return target;
    }

    private Uri findOwnedMediaStoreDownloadUri(ContentResolver resolver, String displayName, String relPath) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
        String[] projection = new String[] {
            MediaStore.Downloads._ID,
            MediaStore.Downloads.DISPLAY_NAME,
            MediaStore.Downloads.RELATIVE_PATH
        };
        String selection =
            MediaStore.Downloads.DISPLAY_NAME + " = ? AND " +
            MediaStore.Downloads.RELATIVE_PATH + " LIKE ?";
        String[] args = new String[] { displayName, relPath + "%" };
        try (Cursor cursor = resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                long id = cursor.getLong(0);
                Uri candidate = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(id));
                try (OutputStream probe = resolver.openOutputStream(candidate, "rwt")) {
                    if (probe != null) {
                        return candidate;
                    }
                } catch (Exception ignored) {
                    // Owned by another UID (e.g., previous uninstall); fall through to insert
                }
            }
        } catch (Exception ignored) {
            // Query not supported or blocked
        }
        return null;
    }

    private void finalizePublicTarget(PublicWriteTarget target, String mimeType) {
        Context ctx = getContext();
        if (ctx == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && target.mediaUri != null) {
            ContentValues doneValues = new ContentValues();
            doneValues.put(MediaStore.Downloads.IS_PENDING, 0);
            try {
                ctx.getContentResolver().update(target.mediaUri, doneValues, null, null);
            } catch (Exception ignored) {
                // Non-fatal
            }
        } else if (target.legacyFile != null) {
            MediaScannerConnection.scanFile(
                ctx,
                new String[] { target.legacyFile.getAbsolutePath() },
                new String[] { mimeType },
                null
            );
        }
    }

    private void abortPublicTarget(PublicWriteTarget target) {
        Context ctx = getContext();
        if (ctx == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && target.mediaUri != null && target.newlyCreatedMediaStoreRow) {
            try {
                ctx.getContentResolver().delete(target.mediaUri, null, null);
            } catch (Exception ignored) {
                // Ignore cleanup error
            }
        } else if (target.legacyFile != null && target.legacyFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            target.legacyFile.delete();
        }
    }

    @PluginMethod
    public void savePublicFile(PluginCall call) {
        String rawFilename = call.getString("filename");
        String base64Data = call.getString("base64Data");
        String mimeTypeArg = call.getString("mimeType");
        String subfolder = call.getString("subfolder", DEFAULT_SUBFOLDER);

        if (rawFilename == null || rawFilename.trim().isEmpty() || base64Data == null || base64Data.isEmpty()) {
            call.reject("filename and base64Data are required");
            return;
        }

        executor.execute(() -> {
            PublicWriteTarget target = null;
            try {
                String safeName = sanitizeFilename(rawFilename);
                String mimeType = inferMimeType(safeName, mimeTypeArg);
                String cleanB64 = base64Data.contains(",") ? base64Data.substring(base64Data.indexOf(',') + 1) : base64Data;
                byte[] bytes = Base64.decode(cleanB64, Base64.DEFAULT);

                target = openPublicDownloadTarget(safeName, mimeType, subfolder);
                try (OutputStream out = target.mediaUri != null
                    ? getContext().getContentResolver().openOutputStream(target.mediaUri, "wt")
                    : new FileOutputStream(target.legacyFile, false)) {
                    if (out == null) {
                        throw new IOException("Unable to open public download stream");
                    }
                    out.write(bytes);
                    out.flush();
                }

                finalizePublicTarget(target, mimeType);
                String uriStr = target.mediaUri != null
                    ? target.mediaUri.toString()
                    : Uri.fromFile(target.legacyFile).toString();

                JSObject res = new JSObject();
                res.put("saved", true);
                res.put("uri", uriStr);
                res.put("folder", target.folderLabel);
                res.put("sizeBytes", bytes.length);
                call.resolve(res);
            } catch (Exception e) {
                if (target != null) abortPublicTarget(target);
                call.reject("Failed to save file: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void downloadToPublicFile(PluginCall call) {
        String urlStr = call.getString("url");
        String rawFilename = call.getString("filename");
        String mimeTypeArg = call.getString("mimeType");
        String subfolder = call.getString("subfolder", DEFAULT_SUBFOLDER);

        if (urlStr == null || urlStr.trim().isEmpty() || rawFilename == null || rawFilename.trim().isEmpty()) {
            call.reject("url and filename are required");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection conn = null;
            PublicWriteTarget target = null;
            try {
                String currentUrl = urlStr.trim();
                for (int hop = 0; hop < 6; hop++) {
                    URL u = new URL(currentUrl);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(45000);
                    conn.setRequestProperty("Accept", "*/*");
                    conn.connect();

                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                        code == HttpURLConnection.HTTP_MOVED_TEMP ||
                        code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null || loc.isEmpty()) {
                            throw new IOException("Empty redirect location");
                        }
                        currentUrl = new URL(u, loc).toString();
                        continue;
                    }
                    break;
                }

                if (conn == null) {
                    throw new IOException("Connection failed");
                }

                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IOException("HTTP error " + status);
                }

                String serverCt = conn.getContentType();
                String lowerCt = serverCt != null ? serverCt.toLowerCase(Locale.ROOT) : "";
                if (lowerCt.contains("text/html") || lowerCt.contains("application/json")) {
                    throw new IOException("HTML response received instead of media file");
                }

                String safeName = sanitizeFilename(rawFilename);
                String mimeType = inferMimeType(safeName, mimeTypeArg != null ? mimeTypeArg : serverCt);
                long totalBytes = conn.getContentLengthLong();
                if (totalBytes <= 0) {
                    String cl = conn.getHeaderField("Content-Length");
                    if (cl != null) {
                        try {
                            totalBytes = Long.parseLong(cl.trim());
                        } catch (NumberFormatException ignored) {
                            totalBytes = 0;
                        }
                    }
                }

                target = openPublicDownloadTarget(safeName, mimeType, subfolder);
                long downloaded = 0;
                long lastEmitAt = 0;

                try (InputStream in = conn.getInputStream();
                     OutputStream out = target.mediaUri != null
                         ? getContext().getContentResolver().openOutputStream(target.mediaUri, "wt")
                         : new FileOutputStream(target.legacyFile, false)) {
                    if (out == null) {
                        throw new IOException("Cannot open output stream");
                    }
                    byte[] buf = new byte[32768];
                    int read;
                    while ((read = in.read(buf)) != -1) {
                        out.write(buf, 0, read);
                        downloaded += read;
                        long now = System.currentTimeMillis();
                        if (now - lastEmitAt >= 200) {
                            lastEmitAt = now;
                            JSObject ev = new JSObject();
                            ev.put("filename", safeName);
                            ev.put("downloadedBytes", downloaded);
                            ev.put("totalBytes", totalBytes);
                            ev.put(
                                "progress",
                                totalBytes > 0 ? Math.min(99, (int) Math.round((downloaded * 100.0) / totalBytes)) : 0
                            );
                            notifyListeners("noorDownloadProgress", ev);
                        }
                    }
                    out.flush();
                }

                if (downloaded <= 0) {
                    throw new IOException("Downloaded file is empty");
                }

                finalizePublicTarget(target, mimeType);
                String uriStr = target.mediaUri != null
                    ? target.mediaUri.toString()
                    : Uri.fromFile(target.legacyFile).toString();

                JSObject res = new JSObject();
                res.put("saved", true);
                res.put("uri", uriStr);
                res.put("folder", target.folderLabel);
                res.put("sizeBytes", downloaded);
                res.put("mimeType", mimeType);
                call.resolve(res);
            } catch (Exception e) {
                if (target != null) abortPublicTarget(target);
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void readUriBase64(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.trim().isEmpty()) {
            call.reject("uri is required");
            return;
        }
        executor.execute(() -> {
            Context ctx = getContext();
            if (ctx == null) {
                call.reject("Context unavailable");
                return;
            }
            try {
                Uri uri = Uri.parse(uriStr.trim());
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try (InputStream in = "file".equalsIgnoreCase(uri.getScheme()) && uri.getPath() != null
                    ? new FileInputStream(new File(uri.getPath()))
                    : ctx.getContentResolver().openInputStream(uri)) {
                    if (in == null) {
                        throw new IOException("Cannot open input stream for URI");
                    }
                    byte[] buf = new byte[16384];
                    int read;
                    while ((read = in.read(buf)) != -1) {
                        baos.write(buf, 0, read);
                    }
                }
                byte[] allBytes = baos.toByteArray();
                String b64 = Base64.encodeToString(allBytes, Base64.NO_WRAP);
                JSObject res = new JSObject();
                res.put("data", b64);
                res.put("sizeBytes", allBytes.length);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Failed to read URI: " + e.getMessage());
            }
        });
    }

    private static final class ScannedEntry {
        String name;
        String uri;
        long sizeBytes;
        String kind;
        String folder;
    }

    private void addDeduped(Map<String, ScannedEntry> map, ScannedEntry entry) {
        if (entry.name == null || entry.name.trim().isEmpty() || entry.uri == null || entry.uri.isEmpty()) {
            return;
        }
        String key = entry.kind + "::" + entry.name.toLowerCase(Locale.ROOT) + "::" + entry.sizeBytes;
        ScannedEntry existing = map.get(key);
        if (existing == null) {
            map.put(key, entry);
        } else if (existing.uri.startsWith("file://") && entry.uri.startsWith("content://")) {
            // Prefer ContentResolver URI on Android 10+ when direct file:// may lack read permission after reinstall
            map.put(key, entry);
        }
    }

    private void scanMediaStoreVideos(ContentResolver resolver, Map<String, ScannedEntry> out) {
        String[] projection = new String[] {
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.MIME_TYPE,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? MediaStore.Video.Media.RELATIVE_PATH : MediaStore.Video.Media.DATA
        };
        try (Cursor c = resolver.query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, projection, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                long id = c.getLong(0);
                String name = c.getString(1);
                long size = c.getLong(2);
                String mime = c.getString(3);
                String loc = c.getString(4);
                if (name == null || size <= 0) continue;
                String kind = detectKind(name, mime);
                if (!"video".equals(kind)) continue;
                ScannedEntry entry = new ScannedEntry();
                entry.name = name;
                entry.uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, String.valueOf(id)).toString();
                entry.sizeBytes = size;
                entry.kind = "video";
                entry.folder = loc != null ? loc : "MediaStore/Video";
                addDeduped(out, entry);
            }
        } catch (Exception ignored) {
            // Ignore provider restriction
        }
    }

    private void scanMediaStoreDownloads(ContentResolver resolver, Map<String, ScannedEntry> out) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        String[] projection = new String[] {
            MediaStore.Downloads._ID,
            MediaStore.Downloads.DISPLAY_NAME,
            MediaStore.Downloads.SIZE,
            MediaStore.Downloads.MIME_TYPE,
            MediaStore.Downloads.RELATIVE_PATH
        };
        try (Cursor c = resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                long id = c.getLong(0);
                String name = c.getString(1);
                long size = c.getLong(2);
                String mime = c.getString(3);
                String rel = c.getString(4);
                if (name == null || size <= 0) continue;
                String kind = detectKind(name, mime);
                if (kind == null) continue;
                ScannedEntry entry = new ScannedEntry();
                entry.name = name;
                entry.uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(id)).toString();
                entry.sizeBytes = size;
                entry.kind = kind;
                entry.folder = rel != null ? rel : "Download";
                addDeduped(out, entry);
            }
        } catch (Exception ignored) {
            // Ignore provider restriction
        }
    }

    private void scanMediaStoreFiles(ContentResolver resolver, Map<String, ScannedEntry> out) {
        Uri filesUri = MediaStore.Files.getContentUri("external");
        String[] projection = new String[] {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.DATA
        };
        String selection =
            MediaStore.Files.FileColumns.MIME_TYPE + " = ? OR " +
            MediaStore.Files.FileColumns.MIME_TYPE + " LIKE ? OR " +
            MediaStore.Files.FileColumns.DISPLAY_NAME + " LIKE ?";
        String[] args = new String[] { "application/pdf", "video/%", "%.pdf" };
        try (Cursor c = resolver.query(filesUri, projection, selection, args, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                long id = c.getLong(0);
                String name = c.getString(1);
                long size = c.getLong(2);
                String mime = c.getString(3);
                String dataPath = c.getString(4);
                if ((name == null || name.isEmpty()) && dataPath != null) {
                    int slash = dataPath.lastIndexOf('/');
                    name = slash >= 0 ? dataPath.substring(slash + 1) : dataPath;
                }
                if (name == null || size <= 0) continue;
                String kind = detectKind(name, mime);
                if (kind == null) continue;
                ScannedEntry entry = new ScannedEntry();
                entry.name = name;
                entry.uri = Uri.withAppendedPath(filesUri, String.valueOf(id)).toString();
                entry.sizeBytes = size;
                entry.kind = kind;
                entry.folder = dataPath != null ? dataPath : "MediaStore/Files";
                addDeduped(out, entry);
            }
        } catch (Exception ignored) {
            // Ignore provider restriction
        }
    }

    private void scanSafTreeRecursive(
        ContentResolver resolver,
        Uri treeUri,
        String documentId,
        int depth,
        Map<String, ScannedEntry> out
    ) {
        if (depth > 3) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
        };
        try (Cursor c = resolver.query(childrenUri, projection, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String childDocId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.isNull(3) ? 0L : c.getLong(3);

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (name != null && !name.startsWith(".")) {
                        scanSafTreeRecursive(resolver, treeUri, childDocId, depth + 1, out);
                    }
                    continue;
                }

                if (name == null || name.startsWith(".")) continue;
                String kind = detectKind(name, mime);
                if (kind == null) continue;

                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                if (size <= 0) {
                    size = queryOpenableSize(resolver, docUri);
                }

                ScannedEntry entry = new ScannedEntry();
                entry.name = name;
                entry.uri = docUri.toString();
                entry.sizeBytes = Math.max(0L, size);
                entry.kind = kind;
                entry.folder = "SAF/" + documentId;
                addDeduped(out, entry);
            }
        } catch (Exception ignored) {
            // Ignore inaccessible subfolder
        }
    }

    private long queryOpenableSize(ContentResolver resolver, Uri uri) {
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                return c.getLong(0);
            }
        } catch (Exception ignored) {
            // Ignore
        }
        return 0L;
    }

    private void scanDirectDirectories(Map<String, ScannedEntry> out) {
        File extRoot = Environment.getExternalStorageDirectory();
        if (extRoot == null) return;
        File[] roots = new File[] {
            new File(extRoot, "Download/NoorElahi"),
            new File(extRoot, "Download/NOOR ELAHI"),
            new File(extRoot, "Download/Noor Elahi"),
            new File(extRoot, "Download"),
            new File(extRoot, "Downloads"),
            new File(extRoot, "Documents/NoorElahi"),
            new File(extRoot, "Documents"),
            new File(extRoot, "Movies/NoorElahi")
        };
        for (File dir : roots) {
            scanDirectFolderRecursive(dir, 0, 2, out);
        }
    }

    private void scanDirectFolderRecursive(File dir, int depth, int maxDepth, Map<String, ScannedEntry> out) {
        if (dir == null || !dir.exists() || !dir.isDirectory() || depth > maxDepth) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File f : children) {
            if (f.getName().startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth < maxDepth) {
                    scanDirectFolderRecursive(f, depth + 1, maxDepth, out);
                }
                continue;
            }
            if (!f.canRead() || f.length() <= 0) continue;
            String kind = detectKind(f.getName(), null);
            if (kind == null) continue;
            ScannedEntry entry = new ScannedEntry();
            entry.name = f.getName();
            entry.uri = Uri.fromFile(f).toString();
            entry.sizeBytes = f.length();
            entry.kind = kind;
            entry.folder = dir.getAbsolutePath();
            addDeduped(out, entry);
        }
    }

    @PluginMethod
    public void scanPublicFiles(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("Context unavailable");
            return;
        }
        executor.execute(() -> {
            try {
                ContentResolver resolver = ctx.getContentResolver();
                Map<String, ScannedEntry> dedupMap = new HashMap<>();

                // 1. MediaStore scans (finds all device videos cleanly across reinstalls once READ_MEDIA_VIDEO granted)
                scanMediaStoreVideos(resolver, dedupMap);
                scanMediaStoreDownloads(resolver, dedupMap);
                scanMediaStoreFiles(resolver, dedupMap);

                // 2. Persisted SAF Trees (finds leftover PDFs AND videos in user-selected Download folder after reinstall)
                for (String treeStr : getPersistedTreeUriStrings()) {
                    try {
                        Uri treeUri = Uri.parse(treeStr);
                        String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
                        scanSafTreeRecursive(resolver, treeUri, rootDocId, 0, dedupMap);
                    } catch (Exception ignored) {
                        // Skip malformed or revoked tree URI
                    }
                }

                // 3. Direct filesystem scan (works on Android <= 10 and whenever MANAGE_EXTERNAL_STORAGE is enabled)
                scanDirectDirectories(dedupMap);

                JSArray list = new JSArray();
                for (ScannedEntry entry : dedupMap.values()) {
                    JSObject obj = new JSObject();
                    obj.put("name", entry.name);
                    obj.put("uri", entry.uri);
                    obj.put("sizeBytes", entry.sizeBytes);
                    obj.put("kind", entry.kind);
                    obj.put("folder", entry.folder);
                    list.put(obj);
                }

                JSObject res = new JSObject();
                res.put("files", list);
                res.put("count", list.length());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Scan failed: " + e.getMessage());
            }
        });
    }
}
