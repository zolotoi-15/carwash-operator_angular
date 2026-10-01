# KkmProxy/Dockerfile
# Multi-stage сборка под Windows-контейнер
FROM mcr.microsoft.com/dotnet/sdk:8.0-windowsservercore-ltsc2022 AS build
WORKDIR /src

# Копируем проект и sln
COPY KkmProxy.sln ./
COPY KkmProxy/KkmProxy.csproj KkmProxy/

# Восстанавливаем зависимости
RUN dotnet restore KkmProxy/KkmProxy.csproj

# Копируем всё остальное (включая lib/*.dll и Properties)
COPY KkmProxy/ KkmProxy/

# Публикуем в Release
RUN dotnet publish KkmProxy/KkmProxy.csproj `
    -c Release `
    -o /app/publish `
    /p:UseAppHost=false

# Runtime-этап
FROM mcr.microsoft.com/dotnet/aspnet:8.0-windowsservercore-ltsc2022 AS runtime
WORKDIR /app

# Копируем собранный релиз
COPY --from=build /app/publish .

# Порт, на котором слушает KkmProxy (проверьте launchSettings.json)
EXPOSE 5000

ENV ASPNETCORE_URLS=http://+:5000
ENV DOTNET_RUNNING_IN_CONTAINER=true

ENTRYPOINT ["dotnet", "KkmProxy.dll"]