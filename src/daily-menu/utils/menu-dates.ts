export function getISTStartOfDay(date: string) {
  const targetDate = date ? new Date(date) : new Date();
  const istDate = new Date(
    targetDate.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
    }),
  );
  return new Date(
    Date.UTC(
      istDate.getFullYear(),
      istDate.getMonth(),
      istDate.getDate(),
      -5,
      -30,
    ),
  );
}
