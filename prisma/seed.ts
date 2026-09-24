import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed RepairFlow.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seed(): Promise<void> {
  const shop = await prisma.shop.upsert({
    where: { slug: "repairflow-demo" },
    update: {},
    create: {
      name: "RepairFlow Demo",
      slug: "repairflow-demo",
      orderCodePrefix: "RFD",
      contactPhone: "0900000000",
    },
  });

  await prisma.branch.upsert({
    where: {
      shopId_name: {
        shopId: shop.id,
        name: "Chi nhánh chính",
      },
    },
    update: {},
    create: {
      shopId: shop.id,
      name: "Chi nhánh chính",
      address: "Dữ liệu minh họa, không phải địa chỉ thật",
    },
  });

  await prisma.qcTemplate.upsert({
    where: {
      shopId_normalizedName_versionNo: {
        shopId: shop.id,
        normalizedName: "kiểm tra thiết bị cơ bản",
        versionNo: 1,
      },
    },
    // Published QC versions are immutable. A replay may encounter a newer active
    // version, so the seed must never reactivate or rewrite version 1.
    update: {},
    create: {
      shopId: shop.id,
      name: "Kiểm tra thiết bị cơ bản",
      normalizedName: "kiểm tra thiết bị cơ bản",
      versionNo: 1,
      items: {
        create: [
          {
            label: "Thiết bị khởi động ổn định",
            isRequired: true,
            allowNa: false,
            sortOrder: 1,
          },
          {
            label: "Sạc và kết nối nguồn bình thường",
            isRequired: true,
            allowNa: false,
            sortOrder: 2,
          },
          {
            label: "Ngoại quan sau sửa đã được kiểm tra",
            isRequired: true,
            allowNa: false,
            sortOrder: 3,
          },
        ],
      },
    },
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
