# User Interface Guide

This guide covers the user interface components and recent updates to Kindred.

## Navigation Structure

### Main Navigation Bar

The navigation bar provides access to all major sections:

- **Logo**: Links to Sessions page
- **Sessions**: View and manage camp sessions
- **Campers**: Browse all campers across sessions
- **Settings**: System configuration
- **Admin** (admin only): Administrative tools
- **Users** (admin only): User management
- **User Profile**: Click user avatar to access profile
- **Theme Toggle**: Switch between light/dark mode

### Mobile Navigation

On mobile devices:
- Hamburger menu for main navigation
- "Refresh Bunking" shows icon only (no text)
- All navigation items stack vertically

## User Profile Page

### Layout
- Modern card-based design
- Centered content for better readability
- Responsive layout adapts to screen size

### Profile Information
- **User Avatar**: Circular icon with user initial
- **Display Name**: Full name prominently displayed
- **Username**: @username format
- **Admin Badge**: Visual indicator for administrators
- **Email Address**: Contact information
- **Group Memberships**: User's assigned groups
- **Account Status**: Shows active/inactive status

### Development Mode Warning
When running in development mode, a yellow warning banner displays:
- Indicates mock authentication is active
- Reminds that user data is not from real auth system
- Only visible in development environment

## Visual Design Updates

### Typography
- Headers use `tracking-tight` for modern appearance
- Consistent font sizing across components
- Clear hierarchy with size and weight

### Color Scheme
- Primary colors for interactive elements
- Muted colors for secondary information
- Destructive colors for dangerous actions
- Proper contrast ratios for accessibility

### Card Components
- Rounded corners (`rounded-xl`)
- Subtle shadows for depth
- Border styling for definition
- Consistent padding and spacing

## Component States

### Loading States
- Spinning loader animation
- Centered in viewport
- Consistent across all pages

### Error States
- Clear error messaging
- Appropriate icons
- Actionable recovery options

### Empty States
- Helpful messages when no data
- Maintains table structure
- Search-specific empty messages

## Responsive Design

### Breakpoints
- `sm`: 640px - Basic mobile layout
- `md`: 768px - Tablet adjustments
- `lg`: 1024px - Desktop features
- `xl`: 1280px - Wide screen optimizations

### Mobile Optimizations
- Touch-friendly button sizes
- Collapsible navigation
- Icon-only buttons where appropriate
- Stacked layouts for narrow screens

## Accessibility Features

### Keyboard Navigation
- Tab order follows visual hierarchy
- Focus indicators on all interactive elements
- Escape key closes modals/menus

### Screen Reader Support
- Semantic HTML structure
- ARIA labels where needed
- Alternative text for icons
- Clear button purposes

### Visual Accessibility
- High contrast mode support
- Clear focus indicators
- Sufficient color contrast
- No color-only information

## Recent UI Updates

### Navigation Improvements
1. Renamed "All Campers" to "Campers" for brevity
2. Removed redundant "Connected" status indicator
3. Added "Users" link for administrators
4. Improved mobile responsiveness

### Profile Page Redesign
1. Removed unnecessary sidebar
2. Centered content layout
3. Added gradient accents
4. Simplified action buttons
5. Better information hierarchy

### Admin Indicators
1. Removed small shield icon from nav
2. Clear admin badge on profile
3. Admin-only navigation items
4. Role-based UI elements

## Best Practices

### Consistency
- Use existing component patterns
- Follow established color schemes
- Maintain spacing standards
- Reuse icon sets

### Performance
- Lazy load heavy components
- Optimize image sizes
- Minimize re-renders
- Use React Query caching

### User Experience
- Clear action labels
- Immediate feedback
- Graceful error handling
- Progressive disclosure

## Component Library

### Icons (Lucide React)
Common icons used:
- `User`: User profiles
- `Users`: Groups/lists
- `Shield`: Admin/security
- `Mail`: Email/contact
- `Settings`: Configuration
- `RefreshCw`: Refresh/sync
- `Loader2`: Loading states

### Utility Classes
- `text-foreground`: Primary text
- `text-muted-foreground`: Secondary text
- `bg-card`: Card backgrounds
- `rounded-xl`: Large border radius
- `shadow-sm`: Subtle shadows
- `tracking-tight`: Tight letter spacing

## Future Enhancements

Planned improvements:
- Enhanced mobile navigation
- More detailed user profiles
- Activity logging display
- Customizable themes
- Improved data tables
- Advanced search filters