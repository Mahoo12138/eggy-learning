
#pragma once
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MAX_BODY 4096
#define DEMO_AMOUNT 5
struct Request { char op[16]; char event[33]; char player[33]; int amount; };
static inline int identifier(const char* text) {
    const size_t n=strlen(text);
    if (!n || n>32) return 0;
    for (size_t i=0;i<n;i++) {
        unsigned char ch=(unsigned char)text[i];
        if (!((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch=='_'||ch=='-')) return 0;
    }
    return 1;
}
static inline int parse_number(const char* text,int maximum,int* out) {
    if (!*text) return 0;
    int value=0;
    for (const char* p=text;*p;p++) {
        if (*p<'0'||*p>'9') return 0;
        int digit=*p-'0';
        if (value>(maximum-digit)/10 || digit>maximum) return 0;
        value=value*10+digit;
    }
    *out=value; return 1;
}
static inline int parse_request(const char* body,struct Request* request) {
    if (strlen(body)>MAX_BODY) return 0;
    char copy[MAX_BODY+1]; strcpy(copy,body);
    char* parts[5]; size_t count=0;
    char* start=copy;
    for (;;) {
        if (count==5) return 0;
        parts[count++]=start;
        char* divider=strchr(start,'|');
        if (!divider) break;
        *divider='\0'; start=divider+1;
    }
    memset(request,0,sizeof(*request));
    if (strlen(parts[0])>=sizeof(request->op)) return 0;
    strcpy(request->op,parts[0]);
    if (!strcmp(parts[0],"PING") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }

    if (!strcmp(parts[0], "ADD") && count==4 && identifier(parts[1]) && identifier(parts[2]) && parse_number(parts[3],1000000,&request->amount) && request->amount>0) {
        strcpy(request->event,parts[1]); strcpy(request->player,parts[2]); return 1;
    }
    if (!strcmp(parts[0], "BALANCE") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }

    if (!strcmp(parts[0], "REDEEM") && count==4 && identifier(parts[1]) && identifier(parts[2]) && parse_number(parts[3],1000000,&request->amount) && request->amount>0) {
        strcpy(request->event,parts[1]); strcpy(request->player,parts[2]); return 1;
    }

    if (!strcmp(parts[0], "TOP") && count==2 && parse_number(parts[1],10,&request->amount) && request->amount>0) return 1;
    if (!strcmp(parts[0], "HISTORY") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }

    return 0;
}
static inline void ping_reply(const char* body,char* response,size_t capacity) {
    struct Request request;
    if (!parse_request(body,&request) || strcmp(request.op,"PING")) snprintf(response,capacity,"ERR|BAD_REQUEST");
    else snprintf(response,capacity,"OK|PONG|%s",request.player);
}
