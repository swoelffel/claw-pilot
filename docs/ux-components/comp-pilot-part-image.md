# Image Part (`cp-pilot-part-image`)

> **Source**: `ui/src/components/pilot/parts/part-image.ts`

Renders a base64-encoded image attachment with thumbnail and click-to-zoom overlay. Used for images uploaded via the file upload button or received from Telegram.

## Mockup

```
┌─ image-container (max 400px) ──┐
│  ┌─────────────────────────┐   │
│  │                         │   │
│  │    [image thumbnail]    │   │  ← click to zoom
│  │    (max-height: 300px)  │   │
│  │                         │   │
│  └─────────────────────────┘   │
│  photo.jpg                     │  ← filename (if available)
└────────────────────────────────┘

┌─ overlay (fullscreen, z-index: 9999) ──────────────┐
│                                                     │
│           [image at 90vw × 90vh max]                │  ← click to close
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Properties

| Property | Type | Description |
|---|---|---|
| `data` | `string` | Base64-encoded image data |
| `mimeType` | `string` | MIME type (default `image/jpeg`) |
| `filename` | `string` | Optional filename displayed below image |

## Design

| Element | Description |
|---|---|
| **Container** | `max-width: 400px` |
| **Thumbnail** | `max-height: 300px`, `border-radius: 8px`, `cursor: pointer`, `object-fit: contain` |
| **Filename** | `font-size: 11px`, `--text-tertiary` |
| **Overlay** | Fixed fullscreen, `background: rgba(0,0,0,0.85)`, click to dismiss |
| **Zoomed image** | `max-width: 90vw`, `max-height: 90vh`, `object-fit: contain` |

## State

| State | Type | Description |
|---|---|---|
| `_zoomed` | `boolean` | Toggles fullscreen overlay |
