---
name: render-view-guide
description: How to use render_view to build interactive mini-apps
trigger: ["visualize", "dashboard", "chart", "render", "build app", "calculator"]
---

# Render View Guide

Use the `render_view` tool to show interactive HTML/CSS/JS views to the user.

## When to use render_view:
- User asks for a visualization → build an HTML chart (Chart.js, D3, or pure CSS)
- User asks for a calculator → build an interactive HTML+JS calculator
- User asks for a dashboard → build a multi-panel HTML dashboard
- User asks for a homepage → build an HTML+CSS landing page
- User asks to convert data → build a sortable HTML table

## How to use it:

### Option 1: Pass HTML directly
```json
{
  "title": "Sales Chart",
  "html": "<html><body><h1>Hello</h1></body></html>"
}
```

### Option 2: Write files first, then render
1. Use write_file to create workspace/myapp/index.html, styles.css, app.js
2. Call render_view with path: "myapp/index.html"

### CDN libraries you can use:
- Chart.js: https://cdn.jsdelivr.net/npm/chart.js
- D3.js: https://cdn.jsdelivr.net/npm/d3
- Alpine.js: https://cdn.jsdelivr.net/npm/alpinejs
- Tailwind (CDN): https://cdn.tailwindcss.com

### Tips:
- Use the same title to update an existing view
- Keep views responsive (mobile-first)
- Test with simple data before complex visualizations
- For multi-file projects, use write_file for each file then render_view with path