import type {
  AdminAnalyticsBook,
  AdminAnalyticsCountry,
  AdminAnalyticsDay,
  AdminAnalyticsOverview,
  AdminAnalyticsPayload,
  AdminAnalyticsTranslation,
  AnalyticsEventType,
  AuthUser,
} from "@ancient-epics/shared";
import type { Context } from "hono";
import type { AppEnv } from "./http";

type AnalyticsBookRow = {
  bookSlug: string;
  title: string;
  viewCount: number;
};

type AnalyticsTranslationRow = {
  bookSlug: string;
  translationSlug: string;
  translationName: string;
  viewCount: number;
};

type AnalyticsDailyRow = {
  eventDate: string;
  signups: number;
  bookViews: number;
  chapterViews: number;
  translationViews: number;
};

type AnalyticsCountryRow = {
  country: string | null;
  signups: number;
  bookViews: number;
  chapterViews: number;
  translationViews: number;
};

type AnalyticsOverviewRow = {
  signups: number;
  bookViews: number;
  chapterViews: number;
  translationViews: number;
  uniqueCountries: number;
};

export async function recordAnalyticsEvent(
  c: Context<AppEnv>,
  input: {
    eventType: AnalyticsEventType;
    userId?: string | null;
    bookSlug?: string | null;
    translationSlug?: string | null;
    chapterSlug?: string | null;
  },
): Promise<void> {
  const now = new Date();
  const geo = getRequestGeo(c);

  await c.env.DB.prepare(
    `
      INSERT INTO analytics_events (
        id,
        event_type,
        event_date,
        occurred_at,
        user_id,
        book_slug,
        translation_slug,
        chapter_slug,
        country,
        region,
        city
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      crypto.randomUUID(),
      input.eventType,
      now.toISOString().slice(0, 10),
      now.toISOString(),
      input.userId ?? null,
      input.bookSlug ?? null,
      input.translationSlug ?? null,
      input.chapterSlug ?? null,
      geo.country,
      geo.region,
      geo.city,
    )
    .run();
}

export async function recordSignupCompleted(c: Context<AppEnv>, user: AuthUser): Promise<void> {
  await recordAnalyticsEvent(c, {
    eventType: "signup_completed",
    userId: user.id,
  });
}

export async function getAdminAnalyticsPayload(db: D1Database, days = 30): Promise<AdminAnalyticsPayload> {
  const normalizedDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) : 30;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - (normalizedDays - 1));
  const startDateString = startDate.toISOString().slice(0, 10);

  const [overviewRow, dailyRows, countryRows, bookRows, translationRows] = await Promise.all([
    db
      .prepare(
        `
          SELECT
            COUNT(CASE WHEN event_type = 'signup_completed' THEN 1 END) AS signups,
            COUNT(CASE WHEN event_type = 'book_view' THEN 1 END) AS bookViews,
            COUNT(CASE WHEN event_type = 'chapter_view' THEN 1 END) AS chapterViews,
            COUNT(CASE WHEN event_type = 'translation_view' THEN 1 END) AS translationViews,
            COUNT(DISTINCT CASE WHEN country IS NOT NULL AND country != '' THEN country END) AS uniqueCountries
          FROM analytics_events
          WHERE event_date >= ?
        `,
      )
      .bind(startDateString)
      .first<AnalyticsOverviewRow>(),
    db
      .prepare(
        `
          SELECT
            event_date AS eventDate,
            COUNT(CASE WHEN event_type = 'signup_completed' THEN 1 END) AS signups,
            COUNT(CASE WHEN event_type = 'book_view' THEN 1 END) AS bookViews,
            COUNT(CASE WHEN event_type = 'chapter_view' THEN 1 END) AS chapterViews,
            COUNT(CASE WHEN event_type = 'translation_view' THEN 1 END) AS translationViews
          FROM analytics_events
          WHERE event_date >= ?
          GROUP BY event_date
          ORDER BY event_date ASC
        `,
      )
      .bind(startDateString)
      .all<AnalyticsDailyRow>(),
    db
      .prepare(
        `
          SELECT
            country,
            COUNT(CASE WHEN event_type = 'signup_completed' THEN 1 END) AS signups,
            COUNT(CASE WHEN event_type = 'book_view' THEN 1 END) AS bookViews,
            COUNT(CASE WHEN event_type = 'chapter_view' THEN 1 END) AS chapterViews,
            COUNT(CASE WHEN event_type = 'translation_view' THEN 1 END) AS translationViews
          FROM analytics_events
          WHERE event_date >= ?
          GROUP BY country
          HAVING
            COUNT(CASE WHEN event_type = 'signup_completed' THEN 1 END) > 0
            OR COUNT(CASE WHEN event_type = 'book_view' THEN 1 END) > 0
            OR COUNT(CASE WHEN event_type = 'chapter_view' THEN 1 END) > 0
            OR COUNT(CASE WHEN event_type = 'translation_view' THEN 1 END) > 0
          ORDER BY
            (
              COUNT(CASE WHEN event_type = 'signup_completed' THEN 1 END)
              + COUNT(CASE WHEN event_type = 'book_view' THEN 1 END)
              + COUNT(CASE WHEN event_type = 'chapter_view' THEN 1 END)
              + COUNT(CASE WHEN event_type = 'translation_view' THEN 1 END)
            ) DESC,
            country ASC
          LIMIT 12
        `,
      )
      .bind(startDateString)
      .all<AnalyticsCountryRow>(),
    db
      .prepare(
        `
          SELECT
            books.slug AS bookSlug,
            books.title AS title,
            COUNT(*) AS viewCount
          FROM analytics_events
          JOIN books
            ON books.slug = analytics_events.book_slug
          WHERE analytics_events.event_type = 'book_view'
            AND analytics_events.event_date >= ?
          GROUP BY books.slug, books.title
          ORDER BY viewCount DESC, books.title ASC
          LIMIT 10
        `,
      )
      .bind(startDateString)
      .all<AnalyticsBookRow>(),
    db
      .prepare(
        `
          SELECT
            books.slug AS bookSlug,
            translations.slug AS translationSlug,
            translations.name AS translationName,
            COUNT(*) AS viewCount
          FROM analytics_events
          JOIN books
            ON books.slug = analytics_events.book_slug
          JOIN translations
            ON translations.book_id = books.id
           AND translations.slug = analytics_events.translation_slug
          WHERE analytics_events.event_type = 'translation_view'
            AND analytics_events.event_date >= ?
          GROUP BY books.slug, translations.slug, translations.name
          ORDER BY viewCount DESC, translations.name ASC
          LIMIT 10
        `,
      )
      .bind(startDateString)
      .all<AnalyticsTranslationRow>(),
  ]);

  const overview = {
    signups: Number(overviewRow?.signups ?? 0),
    bookViews: Number(overviewRow?.bookViews ?? 0),
    chapterViews: Number(overviewRow?.chapterViews ?? 0),
    translationViews: Number(overviewRow?.translationViews ?? 0),
    uniqueCountries: Number(overviewRow?.uniqueCountries ?? 0),
  } satisfies AdminAnalyticsOverview;

  const dailyLookup = new Map(
    (dailyRows.results ?? []).map((row) => [
      row.eventDate,
      {
        signups: Number(row.signups ?? 0),
        bookViews: Number(row.bookViews ?? 0),
        chapterViews: Number(row.chapterViews ?? 0),
        translationViews: Number(row.translationViews ?? 0),
      },
    ]),
  );

  const daily = buildDateSeries(startDateString, normalizedDays).map((date) => {
    const row = dailyLookup.get(date);
    return {
      date,
      signups: row?.signups ?? 0,
      bookViews: row?.bookViews ?? 0,
      chapterViews: row?.chapterViews ?? 0,
      translationViews: row?.translationViews ?? 0,
    } satisfies AdminAnalyticsDay;
  });

  const topCountries = (countryRows.results ?? []).map((row) => ({
    country: normalizeDimensionLabel(row.country, "Unknown"),
    signups: Number(row.signups ?? 0),
    bookViews: Number(row.bookViews ?? 0),
    chapterViews: Number(row.chapterViews ?? 0),
    translationViews: Number(row.translationViews ?? 0),
  })) satisfies AdminAnalyticsCountry[];

  const topBooks = (bookRows.results ?? []).map((row) => ({
    bookSlug: row.bookSlug,
    title: row.title,
    viewCount: Number(row.viewCount ?? 0),
  })) satisfies AdminAnalyticsBook[];

  const topTranslations = (translationRows.results ?? []).map((row) => ({
    bookSlug: row.bookSlug,
    translationSlug: row.translationSlug,
    translationName: row.translationName,
    viewCount: Number(row.viewCount ?? 0),
  })) satisfies AdminAnalyticsTranslation[];

  return {
    days: normalizedDays,
    overview,
    daily,
    topCountries,
    topBooks,
    topTranslations,
  };
}

function getRequestGeo(c: Context<AppEnv>): { country: string | null; region: string | null; city: string | null } {
  const cf = c.req.raw.cf as
    | {
        country?: string;
        regionCode?: string;
        city?: string;
      }
    | undefined;

  return {
    country: cf?.country ?? (c.env.APP_ENV === "development" || c.env.APP_ENV === "test" ? "LOCAL" : null),
    region: cf?.regionCode ?? null,
    city: cf?.city ?? null,
  };
}

function buildDateSeries(startDate: string, length: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);

  for (let index = 0; index < length; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function normalizeDimensionLabel(value: string | null, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}
