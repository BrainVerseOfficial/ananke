# ascnedryx

A modern, dark-themed website with user authentication functionality.

## Features

- **Landing Page** (`index.html`) - Welcome page with features showcase
- **Sign Up Page** (`signup.html`) - User registration with form validation
- **Sign In Page** (`signin.html`) - User authentication
- **Members Area** (`members.html`) - Protected dashboard for logged-in users
- **Dark Mode Design** - Fully dark-themed interface with modern aesthetics

## Technologies

- HTML5
- CSS3 (Custom properties for theming)
- Vanilla JavaScript (LocalStorage for demo authentication)

## How to Use

1. Open `index.html` in your browser
2. Navigate to Sign Up to create an account
3. Sign In with your credentials
4. Access the Members area after authentication

## Authentication

This project uses LocalStorage for demo purposes. In a production environment, you would replace this with proper backend authentication using:
- Server-side session management
- JWT tokens
- Database storage
- Password hashing

## Design Features

- Responsive layout for all screen sizes
- Smooth transitions and hover effects
- Gradient accents and modern UI components
- Form validation
- Protected routes (members area)

## Color Scheme

- Primary Background: `#0a0a0a`
- Secondary Background: `#141414`
- Accent Blue: `#3b82f6`
- Accent Purple: `#8b5cf6`

## Structure

```
.
├── index.html      # Landing page
├── signup.html     # Registration page
├── signin.html     # Login page
├── members.html    # Protected members area
├── styles.css      # Shared styles
└── README.md       # Documentation
```
