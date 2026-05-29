import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationSql = fs
  .readFileSync("prisma/migrations/20240530213853_create_session_table/migration.sql", "utf8")
  .replace('CREATE TABLE "Session"', 'CREATE TABLE IF NOT EXISTS "Session"');

try {
  await prisma.$executeRawUnsafe(migrationSql);
  console.log("Session table ready");
} finally {
  await prisma.$disconnect();
}
