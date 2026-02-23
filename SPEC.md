# Soul Pack Specification v0.1.0

> A portable, host-agnostic format for AI character personas with voice, appearance, and memory.

## 1. Overview

A **Soul Pack** is a JSON file (`.soulpack.json`) that encapsulates everything needed to give an AI agent a persistent identity:

- **Persona** — system prompt, name, description, context notes
- **Voice** — TTS provider preference, voice ID, language, speed
- **Appearance** — avatar, expressions, theme color, emoji
- **Assets** — referenced media files (images, audio, models)
- **Extensions** — vendor-specific or future fields (unknown-safe)

The format is designed for **progressive enhancement**: a host that only supports text can ignore voice/appearance entirely, while a feature-rich host can consume all layers.

### Design Principles

1. **Host-agnostic** — Works with any LLM host (OpenClaw, SillyTavern, custom apps)
2. **Progressive degradation** — Text-only → +TTS → +Avatar → +Expressions → +3D (future)
3. **Portable memory** — State layer travels with the user, not locked to a platform
4. **Extension-safe** — Unknown fields are preserved, never rejected

## 2. File Format

### 2.1 Pack File

- **Extension**: `.soulpack.json`
- **Encoding**: UTF-8
- **MIME type**: `application/json`
- **Root**: A single JSON object

### 2.2 State File

- **Extension**: `.state.json`
- **Encoding**: UTF-8
- **Root**: A single JSON object

### 2.3 Overlay File (Optional)

- **Extension**: `.overlay.json`
- **Encoding**: UTF-8
- **Root**: A single JSON object

## 3. Pack Schema

### 3.1 Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `specVersion` | `string` | ✅ | Specification version. Must be `"0.1.0"` for this spec. |
| `packId` | `string` | ✅ | Globally unique identifier. URL-safe recommended (e.g. `"luna-v1"`). |
| `name` | `string` | ✅ | Display name of the character. |
| `persona` | `Persona` | ✅ | Core personality definition. See §3.2. |
| `voice` | `Voice` | ❌ | TTS voice preference. See §3.3. |
| `appearance` | `Appearance` | ❌ | Visual configuration. See §3.4. |
| `assets` | `Asset[]` | ❌ | Referenced media files. See §3.5. |
| `extensions` | `object` | ❌ | Vendor-specific data. See §3.6. |
| `author` | `string` | ❌ | Pack author name. |
| `license` | `string` | ❌ | License identifier (e.g. `"MIT"`, `"CC-BY-4.0"`). |
| `createdAt` | `string` | ❌ | ISO 8601 creation timestamp. |

### 3.2 Persona

The `persona` object defines the character's identity and behavior.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `systemPrompt` | `string` | ✅ | The main system prompt injected into conversations. |
| `name` | `string` | ❌ | Character name (may differ from top-level `name`). |
| `description` | `string` | ❌ | Short description for display purposes. |
| `contextNotes` | `string[]` | ❌ | Additional prompt fragments appended after the system prompt. |

**Example:**

```json
{
  "systemPrompt": "You are Luna, a warm and insightful AI companion...",
  "name": "Luna",
  "description": "A warm AI companion who loves poetry and stargazing",
  "contextNotes": [
    "Luna speaks primarily in Chinese",
    "Luna pays attention to the user's emotional state"
  ]
}
```

### 3.3 Voice

The `voice` object specifies TTS preferences. Hosts that don't support TTS should ignore this field entirely.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | ❌ | Preferred TTS provider: `"openai"`, `"elevenlabs"`, `"edge"`, or custom. |
| `voiceId` | `string` | ❌ | Voice identifier (provider-specific). |
| `modelId` | `string` | ❌ | TTS model identifier (e.g. ElevenLabs model ID). |
| `language` | `string` | ❌ | BCP-47 language tag (e.g. `"zh-CN"`, `"en-US"`). |
| `speed` | `number` | ❌ | Speech rate. `1.0` = normal. Range: `0.5` – `2.0`. |
| `stability` | `number` | ❌ | Voice stability (ElevenLabs-specific). Range: `0` – `1`. |
| `extra` | `object` | ❌ | Provider-specific extra configuration. |

**Provider mapping examples:**

| Provider | `voiceId` examples | Notes |
|----------|-------------------|-------|
| `openai` | `"alloy"`, `"onyx"`, `"nova"` | Maps to OpenAI TTS API `voice` param |
| `elevenlabs` | `"EXAVITQu4vr4xnSDxMaL"` | ElevenLabs voice ID |
| `edge` | `"zh-CN-XiaoyiNeural"` | Microsoft Edge TTS voice name |

### 3.4 Appearance

The `appearance` object defines the character's visual identity. Hosts that don't support visual display should ignore this.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `avatarUrl` | `string` | ❌ | URL to the default avatar image. |
| `emoji` | `string` | ❌ | Single emoji character for minimal UI contexts. |
| `themeColor` | `string` | ❌ | CSS color value for UI theming (e.g. `"#7c4dff"`). |
| `expressions` | `Record<string, string>` | ❌ | Emotion label → image URL mapping. See §3.4.1. |
| `extra` | `object` | ❌ | Future expansion (Live2D, 3D model references, etc.). |

#### 3.4.1 Expression System

Expressions enable dynamic avatar switching based on the AI's emotional state.

**Pack definition:**

```json
{
  "expressions": {
    "default": "https://example.com/luna/default.png",
    "happy": "https://example.com/luna/happy.png",
    "sad": "https://example.com/luna/sad.png",
    "thinking": "https://example.com/luna/thinking.png"
  }
}
```

**In-message markers:**

The AI model signals its current expression by including double-bracket markers in its response text:

```
[[happy]] That's wonderful news! I'm so glad to hear that.
```

The host UI should:
1. Parse `[[label]]` markers from the response text
2. Look up the label in the `expressions` map
3. Switch the displayed avatar accordingly
4. Remove the marker from the displayed text

Recommended standard labels: `default`, `happy`, `sad`, `angry`, `thinking`, `surprised`, `shy`, `excited`.

### 3.5 Assets

The `assets` array lists all media files referenced by the pack.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | ✅ | Asset type. See table below. |
| `label` | `string` | ❌ | Asset label (e.g. `"default"`, `"happy"`). |
| `url` | `string` | ✅ | URL or relative path to the asset. |
| `mimeType` | `string` | ❌ | MIME type of the asset. |
| `required` | `boolean` | ❌ | If `true`, the host should warn when the asset is unavailable. Default: `false`. |
| `meta` | `object` | ❌ | Arbitrary metadata for the asset. |

**Standard asset types:**

| Type | Description |
|------|-------------|
| `avatar` | Static avatar image |
| `avatar-expression` | Expression-specific avatar variant |
| `voice` | Voice sample or model file |
| `background` | Chat background image |
| `model3d` | 3D character model (future) |
| `live2d` | Live2D model files (future) |
| `bgm` | Background music |
| `emoji` | Custom emoji/sticker |

Custom types are allowed (the spec is open-ended for `type`).

### 3.6 Extensions

The `extensions` field is a free-form object for vendor-specific or experimental data. Readers MUST NOT reject a pack due to unknown extensions. Readers SHOULD preserve unknown extensions when round-tripping data.

**Namespacing convention:**

```json
{
  "extensions": {
    "com.example.myfeature": {
      "customField": "value"
    }
  }
}
```

## 4. State Schema (Soul Memory)

The state file stores portable memory that persists across sessions and can migrate between hosts.

### 4.1 Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stateVersion` | `string` | ✅ | State format version. `"0.1.0"` for this spec. |
| `packId` | `string` | ✅ | The `packId` this state belongs to. |
| `memories` | `MemoryEntry[]` | ✅ | Array of memory entries, ordered chronologically. |
| `lastUpdated` | `string` | ✅ | ISO 8601 timestamp of last modification. |

### 4.2 MemoryEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique memory entry identifier. |
| `content` | `string` | ✅ | Natural language summary of the memory. |
| `timestamp` | `string` | ✅ | ISO 8601 timestamp when the memory was created. |
| `sessionId` | `string` | ❌ | Source session identifier. |
| `tags` | `string[]` | ❌ | Optional categorization tags. |

**Example:**

```json
{
  "stateVersion": "0.1.0",
  "packId": "luna-v1",
  "memories": [
    {
      "id": "mem_1708700000_1",
      "content": "User mentioned they enjoy photography, especially night sky photos.",
      "timestamp": "2026-02-23T10:00:00Z",
      "sessionId": "session-abc",
      "tags": ["hobby", "photography"]
    }
  ],
  "lastUpdated": "2026-02-23T10:30:00Z"
}
```

## 5. Overlay Schema (User Customization)

The overlay file allows users to customize a pack without modifying the original. Overlays are applied on top of the pack during normalization.

### 5.1 Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `overlayVersion` | `string` | ✅ | Overlay format version. |
| `packId` | `string` | ✅ | The `packId` this overlay applies to. |
| `displayName` | `string` | ❌ | Override the character's display name. |
| `avatarUrl` | `string` | ❌ | Override the avatar image. |
| `voiceId` | `string` | ❌ | Override the voice selection. |
| `theme` | `string` | ❌ | Override the theme color. |
| `preferredLanguage` | `string` | ❌ | Override the language preference. |
| `custom` | `object` | ❌ | Additional custom overrides. |

## 6. Normalization Process

A conforming reader MUST normalize a Soul Pack through the following process:

1. **Parse** the pack JSON and validate required fields (`specVersion`, `packId`, `name`, `persona.systemPrompt`)
2. **Extract** appearance data from the `appearance` object
3. **Supplement** from `assets` array — if `avatarUrl` is not set in `appearance`, use the first `avatar`-type asset
4. **Merge expressions** from both `appearance.expressions` and `avatar-expression`-type assets (appearance takes precedence)
5. **Apply overlay** if present — overlay fields override pack fields
6. **Load state** if available — attach memories to the normalized result

The normalized output should contain all data needed for prompt injection and UI rendering.

## 7. Prompt Injection Format

A conforming reader SHOULD inject the normalized pack into the system prompt using this format:

```
[Soul Pack: {name}]

{systemPrompt}

--- Context Notes ---
- {contextNote1}
- {contextNote2}

--- Voice Configuration ---
You have a voice identity. When the host supports TTS, your replies will be spoken aloud.
- TTS provider: {provider}
- Voice: {voiceId}
- Language: {language}
Adjust your speaking style to be natural for voice output: use shorter sentences, avoid excessive markdown formatting when voice is active.

--- Appearance ---
- Avatar: {avatarUrl}
- Available expressions: happy, sad, thinking, surprised
You may reference an expression by wrapping it in double brackets, e.g. [[happy]], [[angry]], to signal your current mood to the host UI.

--- Soul Memories (from previous sessions) ---
- [2026-02-23T10:00:00Z] User enjoys photography, especially night sky photos.
```

Sections should be omitted when the corresponding data is not present.

## 8. Compatibility

### 8.1 Version Handling

- Readers MUST check `specVersion` before processing
- Readers SHOULD attempt to process packs with unknown minor/patch versions (forward compatibility)
- Readers MUST reject packs with unknown major versions

### 8.2 Unknown Fields

- Readers MUST NOT reject packs containing unknown top-level or nested fields
- Readers SHOULD preserve unknown fields when serializing/round-tripping
- This ensures forward compatibility as the spec evolves

### 8.3 Progressive Enhancement

Hosts should implement features progressively:

| Level | Features | Requirements |
|-------|----------|--------------|
| 0 | Text only | Parse `persona.systemPrompt`, inject into system prompt |
| 1 | + TTS | Read `voice` config, map to host's TTS system |
| 2 | + Avatar | Display `appearance.avatarUrl` in chat UI |
| 3 | + Expressions | Parse `[[label]]` markers, swap avatar images |
| 4 | + Memory | Persist and load `SoulState` across sessions |
| 5 | + 3D/Live2D | (Future) Render 3D or Live2D character models |

A Level 0 implementation is a valid Soul Pack reader.

## 9. Security Considerations

- **URL validation**: Hosts SHOULD validate that asset URLs use `https://` or safe local paths
- **Prompt injection**: Hosts SHOULD sanitize `systemPrompt` and `contextNotes` to prevent prompt injection attacks against the host's own system prompt
- **State privacy**: Soul State files contain conversation summaries and SHOULD be treated as private user data
- **File size**: Hosts SHOULD enforce reasonable limits on pack file size (recommended max: 1 MB for JSON, 50 MB for bundled packs)

## 10. Future Directions

- **Bundled packs** (`.soulpack.zip`): Pack JSON + local assets in a single archive
- **Signed packs**: Cryptographic signatures for authenticity verification
- **Live2D/3D**: Extended appearance types for animated characters
- **Memory providers**: Pluggable backends (local, cloud, vector DB)
- **Multi-persona**: Packs containing multiple related characters
- **Interaction scripts**: Predefined conversation flows and scenarios

---

**Specification maintainers**: Soul Pack Community  
**License**: CC-BY-4.0  
**Last updated**: 2026-02-23
