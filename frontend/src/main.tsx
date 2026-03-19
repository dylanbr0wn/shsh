import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App'

// floating-ui reads window.visualViewport.offsetLeft/offsetTop in WebKit environments
// to compensate for pinch-zoom offsets. In the Wails WKWebView these are non-zero due
// to macOS window chrome, which displaces every portalled element (dropdowns, tooltips).
// Force them to 0 so Radix/floating-ui positions portals relative to the actual viewport.
if (window.visualViewport) {
  Object.defineProperty(window.visualViewport, 'offsetLeft', { get: () => 0, configurable: true })
  Object.defineProperty(window.visualViewport, 'offsetTop', { get: () => 0, configurable: true })
}

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
