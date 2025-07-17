# TLEF CREATE

This is a modern web application template using **Vite** for the front-end (React) and **Node.js/Express** for the back-end.

## Configuration

Before running the application, you need to create a `.env` file in the root of the project. This file is used for local configuration and is not committed to version control.

Create a file named `.env` and add the following content:

```
TLEF_CREATE_PORT=8090
```

## Project Structure

-   `src/`: Contains all source code, including the React front-end components and the Node.js/Express server.
-   `public/`: Holds static assets that do not require processing, like favicons or `robots.txt`.
-   `dist/`: The production-ready build output. This directory is generated when you run `npm run build` and is what the production server serves.

## Development

To run the application in development mode, use the following command:

```bash
npm install
npm run dev
```

This command starts two processes in parallel:

1.  **Vite Dev Server (Front-End):**
    -   Serves the React application with Hot Module Replacement (HMR) for a fast development experience.
    -   It will be available at **http://localhost:8080**.
    -   Changes to front-end files in `src/` (e.g., `.tsx`, `.css`) will update the browser instantly.

2.  **Nodemon (Back-End):**
    -   Runs your Express API server.
    -   Automatically restarts the server whenever you make changes to back-end files (e.g., `src/server.js`).

## Production

To run the application in production mode, follow these two steps:

1.  **Build the application:**
    This command bundles and optimizes the React front-end for production, placing the output in the `dist/` directory.

    ```bash
    npm run build
    ```

2.  **Start the server:**
    This command runs the Node.js server, which serves the built front-end files from `dist/`.

    ```bash
    npm start
    ```

## Continuous Integration

Pushing to the main branch in this repo will trigger a deploy automatically to the staging server. The staging server will run the `npm run build` and `npm start` commands.
