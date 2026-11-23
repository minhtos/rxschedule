import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.FHIR_BASE_URL!;
const TOKEN = process.env.FHIR_TOKEN!;

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const target = `${BASE}/${path.join("/")}${req.nextUrl.search}`;

  const res = await fetch(target, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
    },
    body: ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await req.text(),
  });

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type":
        res.headers.get("content-type") ?? "application/fhir+json",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
