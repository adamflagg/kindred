# Responsive Utilities Guide

This project uses a centralized responsive system defined in `index.css` to ensure consistent behavior across all components.

## Breakpoints

- **xs**: 480px - Small mobile devices
- **sm**: 640px - Large mobile devices (Tailwind default)
- **md**: 768px - Tablets (Tailwind default)
- **900px**: Custom - Navigation buttons become icon-only
- **lg**: 1024px - Desktop (Tailwind default)
- **nav**: 1150px - Custom breakpoint for navigation text
- **xl**: 1280px - Wide desktop (Tailwind default)

## Navigation Responsive Strategy

- **0-639px**: Mobile menu only
- **640-900px**: Icons only for Refresh/Upload buttons
- **900-1023px**: Short text ("Refresh", "CSV")
- **1024-1149px**: User menu shows icon only, buttons keep short text
- **1150px+**: Full text for all elements

## Utility Classes

### Navigation Text
For buttons that transition from icon-only → short text → full text:

```jsx
<button className="nav-btn-icon-only">
  <Icon />
  <span className="nav-text-short">Short</span>
  <span className="nav-text-full">Full Text</span>
</button>
```

The `nav-btn-icon-only` class automatically hides all text between 640-900px.

### Stats Labels
For labels that transition from icon → short → full label:

```jsx
<span className="stat-label-icon">+</span>
<span className="stat-label-short">+</span>
<span className="stat-label-full">Created: </span>
```

### Spacing
Responsive spacing that increases with screen size:

```jsx
<div className="nav-spacing">
  <!-- Applies space-x-2 md:space-x-3 lg:space-x-4 -->
</div>
```

### Visibility
Progressive display utilities:

```jsx
<div className="show-tablet">  <!-- Hidden until md breakpoint -->
<div className="show-desktop"> <!-- Hidden until lg breakpoint -->
<div className="hide-tablet">   <!-- Visible until md breakpoint -->
<div className="hide-desktop">  <!-- Visible until lg breakpoint -->
```

## Usage Example

```jsx
// Before (scattered responsive logic)
<span className="hidden sm:inline lg:hidden">Refresh</span>
<span className="hidden lg:inline">Refresh Bunking</span>

// After (centralized utilities)
<span className="nav-text-short">Refresh</span>
<span className="nav-text-full">Refresh Bunking</span>
```

## Benefits

1. **Consistency**: Same breakpoints used everywhere
2. **Maintainability**: Change breakpoints in one place
3. **No Gaps**: Mobile-first approach ensures coverage at all sizes
4. **Reusability**: Same utilities can be used across components
5. **Clarity**: Self-documenting class names