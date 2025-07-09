# TLEF CREATE

This is a template Node.js application.

## Configuration

Before running the application, you need to create a `.env` file in the root of the project. This file is used for local configuration and is not committed to version control.

Create a file named `.env` and add the following content:

```
TLEF_CREATE_PORT=8090
```

## Development

To run the application in development mode, run the following command:

```bash
npm run dev
```

This will start the Node.js server with `nodemon` for backend reloading and also launch `BrowserSync`. BrowserSync will automatically open a new tab in your browser. Use the URL it provides (usually `http://localhost:3000`) for development.

Any changes to frontend files in the `public` directory will cause the browser to reload automatically. Changes to backend files in the `src` directory will cause the server to restart.

## Production

To run the application in production mode, use the following command:

```bash
npm start
```

## Continuius Integration

Pushing to the main branch in this repo will trigger a deploy automatically to the staging server.
