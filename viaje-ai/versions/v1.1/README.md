# ruta / AI

Aplicación Next.js 1.1 para crear itinerarios personalizados con Gemini. El acceso de usuarios se realiza con Google OAuth y la clave de Gemini permanece en el servidor. La versión visual anterior está archivada en `versions/v1.0`.

## Arranque local

1. Abre `.env.local` y sustituye `pega_aqui_tu_clave_real_de_gemini` por una clave real de Gemini. Puedes crearla en [Google AI Studio](https://aistudio.google.com/apikey).
2. Instala dependencias con `npm install`.
3. Reinicia `npm run dev` después de cambiar la clave y abre `http://localhost:3000`.

## Configurar Google OAuth

En Google Cloud Console crea un cliente OAuth de tipo aplicación web. Añade esta URI de redirección autorizada:

`http://localhost:3000/api/auth/callback/google`

Completa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `NEXTAUTH_SECRET` en `.env.local`. En producción, cambia `NEXTAUTH_URL` y la URI por el dominio real; nunca publiques `.env.local`.

## Mapas visibles

Para dibujar la ruta andando dentro de cada día, crea una clave en Google Cloud Console, habilita **Maps Embed API** y añade una restricción HTTP para `http://localhost:3000/*`. Después completa:

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=tu_clave_de_maps`

Sin esta variable, la aplicación muestra en pantalla el mapa del punto principal del día y mantiene el enlace de ruta andando para abrirlo o exportarlo en Google Maps.

La clave se utiliza únicamente en `src/app/api/itinerary/route.ts`, en el servidor. Sin clave, la interfaz sigue mostrando una ruta de ejemplo y explica cómo activar la generación real.This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
