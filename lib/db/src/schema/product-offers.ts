import { createInsertSchema } from "drizzle-zod";
import {
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const productOffersTable = pgTable(
  "product_offers",
  {
    id: serial("id").primaryKey(),
    supermarket: text("supermarket").notNull(),
    flyerDate: date("flyer_date", { mode: "string" }).notNull(),
    category: text("category").notNull(),
    productName: text("product_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("product_offers_supermarket_normalized_name_unique").on(
      table.supermarket,
      table.normalizedName,
    ),
  ],
);

export const insertProductOfferSchema = createInsertSchema(productOffersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProductOffer = z.infer<typeof insertProductOfferSchema>;
export type ProductOffer = typeof productOffersTable.$inferSelect;

export const shoppingListItemsTable = pgTable(
  "shopping_list_items",
  {
    id: serial("id").primaryKey(),
    productName: text("product_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("shopping_list_items_normalized_name_unique").on(table.normalizedName)],
);

export const insertShoppingListItemSchema = createInsertSchema(
  shoppingListItemsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShoppingListItem = z.infer<typeof insertShoppingListItemSchema>;
export type ShoppingListItem = typeof shoppingListItemsTable.$inferSelect;
