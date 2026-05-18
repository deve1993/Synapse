# Synapse 3D UI Skills Pack — Design

**Date**: 2026-05-18
**Status**: Approved
**Author**: daniel (devecchidaniel93@gmail.com)

## Goal

Add a complete knowledge base for 3D web to Synapse: CSS transforms, scroll-driven animations, Three.js / R3F, shaders, asset pipeline, post-FX, WebGPU, physics, no-code 3D tools, WebXR.

11 skills total, all `domain` type, generic-first with a final "Using with Next.js" section where relevant.

## Constraints

- One skill per iteration — user reviews before next one starts.
- Generic + Next.js note (not Pixarts-locked).
- Match existing skill style (concise frontmatter, code-heavy body, ≤500 lines).
- Save into the Synapse DB after each skill via `import-skills .`.
- No git push without explicit user request.

## Skill List & Order

| # | Name | Scope |
|---|------|-------|
| 1 | `css-3d-transforms` | Pure CSS 3D: perspective, preserve-3d, rotateX/Y/Z, backface-visibility, card flip, cube, coverflow, CSS parallax. |
| 2 | `scroll-3d-animations` | CSS Scroll-Driven Animations, GSAP ScrollTrigger, Framer Motion `useScroll`, parallax 3D. |
| 3 | `threejs-fundamentals` | Three.js core: scene/camera/renderer, lights, materials, GLTF loader, raycaster, controls, render loop. |
| 4 | `react-three-fiber` | R3F + `@react-three/drei`, hooks, Canvas, suspense, SSR-safe wrapper. |
| 5 | `glsl-shaders` | Vertex/fragment, uniforms, noise, `shaderMaterial` in R3F, raymarching primer. |
| 6 | `gltf-asset-pipeline` | Blender → glTF, Draco/Meshopt, KTX2, `gltfjsx`, hosting & cache headers. |
| 7 | `r3f-postprocessing` | `@react-three/postprocessing`: bloom, DOF, chromatic aberration, performance budget. |
| 8 | `webgpu-tsl` | WebGPU vs WebGL2, Three.js TSL, compute shaders, feature detection / fallback. |
| 9 | `r3f-physics` | `@react-three/rapier`: rigid bodies, joints, drag 3D, collisions. |
| 10 | `spline-rive-web` | Spline runtime, Rive 2D/3D motion graphics, web export. |
| 11 | `webxr-spatial` | WebXR session, VR/AR, hand tracking, spatial UI, immersive mode. |

## Skill File Structure

```
.claude/skill/<name>/
├── SKILL.md                  # frontmatter + body
└── evals/
    └── trigger_evals.json    # 5+ trigger test cases
```

### Frontmatter

```yaml
---
name: <name>
description: <one-line trigger + use-when phrases for FTS routing>
version: 1.0.0
---
```

### Body sections (in order)

1. Overview — what + core principle
2. When to Use — bullets, including "don't use when"
3. Setup — installation, deps, browser support
4. Core Patterns — code-heavy, runnable examples
5. Performance — budgets, mobile considerations
6. Using with Next.js — SSR safety, dynamic import, build size (only when relevant)
7. Examples — 2-3 scenarios
8. Troubleshooting — common errors + fixes

## Per-Skill Workflow

For each skill in the list:

1. Create `.claude/skill/<name>/SKILL.md` and `evals/trigger_evals.json`.
2. Present diff/preview to user for review.
3. On user approval, run `node packages/codegraph/dist/cli.js import-skills .`.
4. Verify: `sqlite3 .codegraph/graph.db "SELECT name, type FROM skills WHERE name='<name>';"`.
5. Move to next skill.

No commits/pushes until user explicitly requests.

## Quality Bar

- Frontmatter description includes trigger phrases ("Use when…", "3D in browser", "Three.js", etc.).
- Body in markdown, ≤500 lines, positive framing (no NEVER/ALWAYS bursts).
- Code examples are copy-pasteable and current (2025/2026 versions).
- `trigger_evals.json` has 5+ `should_trigger` and 2+ `should_not_trigger`.
- Cross-links to related existing skills (`animations`, `motion-system`, `shadcn`) where relevant.

## Non-Goals

- Not adding `agent:*` or `command:*` skills — only `domain`.
- Not building a 3D component library — only knowledge skills.
- Not creating runnable demos / playgrounds.
- Not modifying existing UI/UX skills.
