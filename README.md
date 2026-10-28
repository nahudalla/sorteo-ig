# sorteo-ig

Página para hacer sorteos de Instagram corriendo en tu compu. Pegás la URL del post, definís las reglas y se sortea entre los comentarios que las cumplen.

## Uso

Requiere Node.js 18 o más nuevo. No tiene dependencias.

```bash
npm start
```

Abrí http://localhost:3000.

1. **Conectá tu cuenta de Instagram** (botón arriba a la derecha). Para leer comentarios, likes y seguidores, la página usa la sesión de tu cuenta: copiá el valor de la cookie `sessionid` desde las herramientas de desarrollador del navegador, con instagram.com abierto y la sesión iniciada (Application → Cookies). La sesión queda guardada sólo en `.ig-session.json`, que está en `.gitignore`. También podés pasarla con la variable de entorno `IG_SESSIONID` o `IG_COOKIE`.
2. **Pegá la URL del post** (`/p/…` o `/reel/…`). Los comentarios se traen despacio a propósito, para que Instagram no limite la cuenta.
3. **Configurá las reglas** y mirá en vivo cuántos participantes quedan en cada sorteo.
4. **Sorteá.** Al que sale sorteado se le verifica que siga la cuenta y que haya dado like (si lo pediste). Si no cumple, queda descalificado y se sortea otro.
5. **Resultados:** tenés un texto listo para anunciar y un CSV con todos los participantes y el motivo por el que se descartó cada comentario.

Sin conectar Instagram también podés **importar comentarios** (JSON, CSV o líneas `usuario: comentario`) o **probar con datos de ejemplo**.

## Reglas

- **Palabras clave:** cada palabra puede ser un sorteo aparte con su propio premio (por ejemplo, "comic" y "manga"), o puede haber un solo sorteo. Se buscan como palabra completa y no importan las tildes ni las mayúsculas. Para aceptar variantes, separalas con coma: `comic, cómic, comics`. Un mismo usuario puede participar en varios sorteos.
- **Menciones:** cantidad mínima de cuentas etiquetadas. Etiquetarse a uno mismo o a la cuenta organizadora no cuenta.
- **Varias participaciones:** cada comentario válido suma una chance, pero un comentario extra sólo cuenta si etiqueta gente diferente. Hay dos modos:
  - *Personas nuevas* (por defecto): sólo se cuentan las personas que ese usuario todavía no había etiquetado, y tienen que llegar al mínimo.
  - *Combinación distinta:* alcanza con que el grupo etiquetado no sea exactamente el mismo que en otro comentario.
- **Comentarios repetidos:** si un usuario repite el mismo texto, cuenta sólo el primero.
- **Otras opciones:** excluir cuentas, incluir o no las respuestas a comentarios, y evitar que una misma persona gane más de un sorteo.

El ganador se elige con `crypto.getRandomValues`. Cada participación válida es una chance, y una misma persona no puede salir dos veces en el mismo sorteo.

## Notas

- Usa la API web no oficial de Instagram, que puede cambiar sin aviso. Si deja de funcionar, siempre queda la opción de importar comentarios.
- En posts con muchos likes, Instagram puede devolver una lista de likes incompleta. En ese caso la página no descalifica a nadie y te pide confirmar a mano.

## Tests

```bash
npm test
```
