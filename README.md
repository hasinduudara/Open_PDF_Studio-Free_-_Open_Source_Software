# Open PDF Studio

A modern, fast, privacy-focused, and free open-source desktop PDF reader and document suite built with Tauri v2, React 19, and Tailwind CSS v4.

---

## 📖 Overview

**Open PDF Studio** is designed as a lightweight, clean, and distraction-free alternative to bloated desktop PDF viewers. All document processing happens strictly on your local device—ensuring 100% privacy with zero telemetry or cloud requirements.

---

## ✨ Planned Features

- **Document Viewing & Navigation**:
  - High-fidelity PDF rendering with hardware acceleration via PDF.js.
  - Multi-page continuous scroll, single-page presentation, and two-page spread views.
  - Interactive table of contents / outline drawer, thumbnail navigation, and bookmarks.
- **Viewing Controls & Ergonomics**:
  - Zoom controls (fit-to-width, fit-to-page, custom percentage presets) and rotation.
  - Keyboard shortcuts for rapid navigation and page jumping.
  - Native dark mode and high-contrast reading themes.
- **Search & Selection**:
  - Full-text search with keyword highlighting and match counters.
  - Smooth text selection and clipboard copying.
- **Document Metadata & Management**:
  - File details inspection (author, creation date, PDF version, page count).
  - Recent documents list with fast access.
- **Annotations & Page Manipulation** *(Roadmap)*:
  - Text highlights, notes, and underlines.
  - Page reordering, rotation, deletion, and extraction powered by `pdf-lib`.

---

## 🛠️ Tech Stack

- **Desktop Framework**: [Tauri v2](https://tauri.app/) (Rust-based secure and lightweight native shell)
- **Frontend UI**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler & Tooling**: [Vite](https://vite.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) (using `@tailwindcss/vite`)
- **PDF Engine**: [PDF.js](https://mozilla.github.io/pdf.js/) & [pdf-lib](https://pdf-lib.js.org/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Rust & Cargo](https://www.rust-lang.org/) (for Tauri desktop runtime)

### Installation

```bash
# Clone the repository
git clone https://github.com/hasinduudara/Open_PDF_Studio-Free_-_Open_Source_Software.git
cd open-pdf-studio

# Install dependencies
npm install
```

### Development

To start the Vite dev server with Tauri desktop shell:

```bash
npm run tauri dev
```

Or run frontend-only preview in your browser:

```bash
npm run dev
```

### Build

```bash
# Build desktop release binary
npm run tauri build
```

---

## 📄 License

Open PDF Studio is licensed under the **GNU General Public License v3.0 (GPLv3)**. See the [LICENSE](LICENSE) file for the full license text.
