// src/auth.ts
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const encoder = new TextEncoder();
const secret = encoder.encode(process.env.JWT_SECRET!);

export async function issueToken(payload: JWTPayload) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("2h")
        .sign(secret);
}

export async function verifyToken(token: string) {
    const { payload } = await jwtVerify(token, secret);
    return payload;
}